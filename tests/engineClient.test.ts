import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from '../src/engineClient';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: string[] = [];
  terminated = false;

  postMessage(message: string): void {
    this.messages.push(message);
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
});

describe('EngineClient searches', () => {
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
