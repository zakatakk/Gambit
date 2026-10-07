import { describe, expect, it, vi } from 'vitest';
import { EngineClient, pickMove } from '../src/engineClient';
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

type InfoLines = Parameters<typeof pickMove>[0];
const infoLine = (multipv: number, cp: number, move: string): InfoLines[number] =>
  ({ multipv, cp, mate: null, depth: 8, pv: [move] });

describe('pickMove blunder selection', () => {
  // multipv ordering mirrors real engine output: scores descend with multipv.
  const lines: InfoLines = [
    infoLine(1, 100, 'e2e4'),
    infoLine(2, 50, 'd2d4'),
    infoLine(3, -2000, 'f2f3'),
    infoLine(4, 20, 'g2g4'),
  ];
  const base = {
    skill: 0,
    limitedElo: null,
    moveTime: 700,
    blunderChance: 1,
    blunderWindowCp: 320,
    blunderFloorCp: -400,
    randomCp: 0,
  };

  it('picks a weaker candidate inside the blunder window', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      expect(pickMove(lines, base)).toBe('g2g4');
    } finally {
      spy.mockRestore();
    }
  });

  it('never blunders below the floor, even with a huge window', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const unlimited = { ...base, blunderWindowCp: 5000, blunderFloorCp: -5000 };
      expect(pickMove(lines, unlimited)).toBe('f2f3');
      const floored = { ...base, blunderWindowCp: 5000, blunderFloorCp: -400 };
      expect(pickMove(lines, floored)).toBe('g2g4');
    } finally {
      spy.mockRestore();
    }
  });

  it('window limits how far down the pool a blunder can reach', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const narrow = { ...base, blunderWindowCp: 50, blunderFloorCp: -5000 };
      // 80cp-loss g2g4 is out of the window; only e2e4/d2d4 qualify.
      expect(pickMove(lines, narrow)).toBe('d2d4');
    } finally {
      spy.mockRestore();
    }
  });

  it('randomizes among near-best moves when not blundering', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const calm = { ...base, blunderChance: 0, randomCp: 60 };
      expect(pickMove(lines, calm)).toBe('d2d4');
    } finally {
      spy.mockRestore();
    }
  });
});
