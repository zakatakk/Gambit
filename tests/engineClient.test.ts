import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from '../src/engineClient';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: string[] = [];
  terminated = false;
  onPostMessage: ((message: string) => void) | null = null;

  postMessage(message: string): void {
    this.messages.push(message);
    this.onPostMessage?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(line: string): void {
    this.onmessage?.({ data: line } as MessageEvent);
  }

  crash(message = 'worker failed'): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function createClient(): { client: EngineClient; worker: MockWorker } {
  const client = new EngineClient();
  const worker = new MockWorker();
  const internals = client as unknown as {
    worker: Worker | null;
    currentTier: 'lite' | null;
    lineHandler: ((line: string) => void) | null;
    activeSearchFailure: ((error: Error) => void) | null;
    discardWorker: (worker: Worker) => void;
  };
  internals.worker = worker as unknown as Worker;
  internals.currentTier = 'lite';
  worker.onmessage = (event) => internals.lineHandler?.(String(event.data));
  worker.onerror = (event) => {
    const error = new Error(event.message || 'engine worker failed');
    if (internals.activeSearchFailure) internals.activeSearchFailure(error);
    else internals.discardWorker(worker as unknown as Worker);
  };
  return { client, worker };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EngineClient searches', () => {
  it('shares an in-flight initialization for the same engine tier', async () => {
    const workers: MockWorker[] = [];
    class ReadyWorker extends MockWorker {
      constructor() {
        super();
        workers.push(this);
        this.onPostMessage = (message) => {
          if (message === 'uci') this.emit('uciok');
          else if (message === 'isready') {
            this.emit('Load eval file success: 1');
            // Stockfish may not print its NNUE-enabled info until the first go.
            this.emit('readyok');
          } else if (message.startsWith('go movetime')) {
            this.emit('info string NNUE evaluation enabled.');
            this.emit('bestmove e2e4');
          }
        };
      }
    }
    const fetchStub = vi.fn(async (_url: string) => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal('Worker', ReadyWorker);
    const client = new EngineClient();

    await Promise.all([client.init('full'), client.init('full')]);

    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('stockfish-nnue-16-single.js'),
      expect.stringContaining('stockfish-nnue-16-single.wasm'),
      expect.stringContaining('nn-5af11540bbfe.nnue'),
    ]);
    expect(workers).toHaveLength(1);
    expect(workers[0].messages.filter((message) => message === 'uci')).toHaveLength(1);
    expect(client.tier).toBe('full');
    await expect(client.play('start-fen', {
      skill: 0,
      limitedElo: null,
      moveTime: 220,
      blunderChance: 0,
      randomCp: 0,
    })).resolves.toEqual({ from: 'e2', to: 'e4' });
  });

  it('rejects full initialization when the NNUE network cannot be loaded', async () => {
    class MissingNetworkWorker extends MockWorker {
      constructor() {
        super();
        this.onPostMessage = (message) => {
          if (message === 'uci') this.emit('uciok');
          else if (message === 'isready') {
            this.emit('Failed to download eval file.');
            this.emit('readyok');
          }
        };
      }
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => new Response(null, { status: 200 })));
    vi.stubGlobal('Worker', MissingNetworkWorker);
    const client = new EngineClient();

    await expect(client.init('full')).rejects.toThrow('Stockfish could not load its NNUE network');
    expect(client.tier).toBeNull();
  });

  it('resolves when Stockfish returns bestmove', async () => {
    const { client, worker } = createClient();
    const analysis = client.analyse('test-fen', 220, () => {});

    expect(worker.messages).toContain('go movetime 220');
    worker.emit('bestmove e2e4 ponder e7e5');

    await expect(analysis).resolves.toEqual({ from: 'e2', to: 'e4' });
    expect(worker.terminated).toBe(false);
  });

  it('rejects on worker errors and discards the broken worker', async () => {
    const { client, worker } = createClient();
    const analysis = client.analyse('test-fen', 220, () => {});

    worker.crash('engine crashed');

    await expect(analysis).rejects.toThrow('engine crashed');
    expect(worker.terminated).toBe(true);
    expect(client.tier).toBeNull();
  });

  it('stops and rejects a search that never returns bestmove', async () => {
    vi.useFakeTimers();
    const { client, worker } = createClient();
    const analysis = client.analyse('test-fen', 220, () => {});
    const rejected = expect(analysis).rejects.toThrow('Engine search timed out; the worker stopped responding');

    await vi.advanceTimersByTimeAsync(6_500);
    await rejected;

    expect(worker.messages).toContain('stop');
    expect(worker.terminated).toBe(true);
    expect(client.tier).toBeNull();
  });

  it('accepts bestmove after stopping an overlong search', async () => {
    vi.useFakeTimers();
    const { client, worker } = createClient();
    const analysis = client.analyse('test-fen', 220, () => {});

    await vi.advanceTimersByTimeAsync(5_000);
    expect(worker.messages).toContain('stop');
    worker.emit('bestmove e2e4');

    await expect(analysis).resolves.toEqual({ from: 'e2', to: 'e4' });
    expect(worker.terminated).toBe(false);
    expect(client.tier).toBe('lite');
  });
});
