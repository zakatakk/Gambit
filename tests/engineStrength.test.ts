import { describe, expect, it } from 'vitest';
import { EngineClient } from '../src/engineClient';
import { ratingToStrength } from '../src/engineStrength';
import type { EngineStrengthParams } from '../src/engineProtocol';

describe('ratingToStrength', () => {
  it('caps and floors the requested rating', () => {
    expect(ratingToStrength(100, 'lite').depth).toBe(ratingToStrength(600, 'lite').depth);
    expect(ratingToStrength(5000, 'full')).toEqual(ratingToStrength(2900, 'full'));
    expect(ratingToStrength(5000, 'lite')).toEqual(ratingToStrength(2350, 'lite'));
  });

  it('searches deeper as the advertised rating grows', () => {
    let previous = 0;
    for (let r = 600; r <= 2340; r += 20) {
      const depth = ratingToStrength(r, 'lite').depth;
      expect(depth).not.toBeNull();
      expect(depth as number).toBeGreaterThanOrEqual(previous);
      previous = depth as number;
    }
    expect(ratingToStrength(600, 'lite').depth).toBe(1);
    expect(ratingToStrength(1300, 'lite').depth).toBe(5);
    expect(ratingToStrength(2340, 'full').depth).toBe(12);
  });

  it('weak ratings blunder from a wide, unbounded pool', () => {
    const weak = ratingToStrength(800, 'lite');
    expect(weak.depth).toBe(2);
    expect(weak.multipv).toBe(20);
    expect(weak.blunderChance).toBeGreaterThan(0.4);
    expect(weak.blunderFloorCp).toBeLessThanOrEqual(-1000);
    expect(weak.blunderWindowCp).toBeGreaterThan(800);
    expect(weak.limitedElo).toBeNull();

    const fair = ratingToStrength(1300, 'full');
    expect(fair.depth).toBe(5);
    expect(fair.blunderChance).toBeLessThan(weak.blunderChance);
    expect(fair.blunderFloorCp).toBeGreaterThan(weak.blunderFloorCp);
    expect(fair.limitedElo).toBeNull();
  });

  it('strength tapers smoothly through the strong band', () => {
    const mid = ratingToStrength(2000, 'lite');
    expect(mid.depth).toBe(11);
    expect(mid.blunderChance).toBeGreaterThan(0);
    expect(mid.blunderChance).toBeLessThan(0.1);
    expect(mid.limitedElo).toBeNull();
  });

  it('reserves the move-time band for top ratings and Elo-limits only the full tier', () => {
    const liteTop = ratingToStrength(2350, 'lite');
    expect(liteTop.depth).toBeNull();
    expect(liteTop.skill).toBe(16);
    expect(liteTop.limitedElo).toBeNull(); // the lite engine has no UCI_Elo option

    const fullTop = ratingToStrength(2350, 'full');
    expect(fullTop.depth).toBeNull();
    expect(fullTop.limitedElo).toBe(2350);

    const maxed = ratingToStrength(2900, 'full');
    expect(maxed.skill).toBe(20);
    expect(maxed.limitedElo).toBe(2850);
    expect(maxed.blunderChance).toBe(0);
    expect(maxed.randomCp).toBe(0);
  });
});

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: string[] = [];
  onPostMessage: ((message: string) => void) | null = null;

  postMessage(message: string): void {
    this.messages.push(message);
    this.onPostMessage?.(message);
  }

  terminate(): void {
    // no-op in tests
  }

  emit(line: string): void {
    this.onmessage?.({ data: line } as MessageEvent);
  }
}

describe('EngineClient depth-limited play', () => {
  it('sends go depth, a wide MultiPV pool, and no dead Elo options for weak play', async () => {
    const client = new EngineClient();
    const worker = new MockWorker();
    const internals = client as unknown as {
      worker: Worker | null;
      currentTier: 'lite' | null;
      lineHandler: ((line: string) => void) | null;
      activeSearchFailure: ((error: Error) => void) | null;
    };
    internals.worker = worker as unknown as Worker;
    internals.currentTier = 'lite';
    worker.onmessage = (event) => internals.lineHandler?.(String(event.data));
    worker.onPostMessage = (message) => {
      if (message === 'uci') worker.emit('uciok');
      else if (message === 'isready') worker.emit('readyok');
      else if (message.startsWith('go depth')) worker.emit('bestmove e2e4');
    };
    await client.init('lite');

    const weak: EngineStrengthParams = {
      skill: 0,
      limitedElo: null,
      moveTime: 700,
      depth: 2,
      multipv: 20,
      blunderChance: 0.47,
      blunderWindowCp: 1100,
      blunderFloorCp: -1800,
      randomCp: 189,
    };
    await expect(client.play('test-fen', weak)).resolves.toEqual({ from: 'e2', to: 'e4' });

    expect(worker.messages).toContain('go depth 2');
    expect(worker.messages).toContain('setoption name MultiPV value 20');
    expect(worker.messages).not.toContain('setoption name UCI_LimitStrength value true');
    expect(worker.messages.some((m) => m.startsWith('go movetime'))).toBe(false);
  });
});
