import { describe, expect, it } from 'vitest';
import {
  explainMove,
  judgeMove,
  QUALITY_GLYPHS,
  toCp,
  type MoveJudgement,
} from '../src/moveReview';

function judge(overrides: Partial<Parameters<typeof judgeMove>[0]> = {}) {
  return judgeMove({
    playedUci: 'g1f3',
    bestUci: 'g1f3',
    beforeCp: 30,
    beforeMate: null,
    afterCp: 30,
    afterMate: null,
    mover: 'w',
    ...overrides,
  });
}

describe('toCp', () => {
  it('passes centipawns through and folds mates near +-10000', () => {
    expect(toCp(42, null)).toBe(42);
    expect(toCp(null, 3)).toBe(9700);
    expect(toCp(null, -2)).toBe(-9800);
    expect(toCp(null, null)).toBeNull();
  });
});

describe('judgeMove', () => {
  it('rates the engine top choice as best', () => {
    expect(judge()?.quality).toBe('best');
    expect(judge()?.lossCp).toBe(0);
  });

  it('rates a small eval drop as good when the best move differs', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: 10 });
    expect(j?.quality).toBe('good');
  });

  it('band edges: loss 30 is good, 31 an inaccuracy, 100 mistake, 251 blunder', () => {
    expect(judge({ playedUci: 'a2a3', afterCp: 0 })?.quality).toBe('good'); // loss 30
    expect(judge({ playedUci: 'a2a3', afterCp: -1 })?.quality).toBe('inaccuracy'); // loss 31
    expect(judge({ playedUci: 'a2a3', afterCp: -70 })?.quality).toBe('mistake'); // loss 100
    expect(judge({ playedUci: 'a2a3', afterCp: -71 })?.quality).toBe('mistake'); // loss 101
    expect(judge({ playedUci: 'a2a3', afterCp: -220 })?.quality).toBe('mistake'); // loss 250
    expect(judge({ playedUci: 'a2a3', afterCp: -221 })?.quality).toBe('blunder'); // loss 251
  });

  it('black loses when the eval rises toward white', () => {
    const j = judge({ mover: 'b', bestUci: null, beforeCp: -20, afterCp: 180 });
    expect(j?.quality).toBe('mistake'); // black's loss = 200
  });

  it('clamps negative swings (eval improvements) to zero loss', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: 90 });
    expect(j?.lossCp).toBe(0);
    expect(j?.quality).toBe('good');
  });
  it('returns null when either eval is missing', () => {
    expect(judge({ beforeCp: null, beforeMate: null })).toBeNull();
    expect(judge({ afterCp: null, afterMate: null })).toBeNull();
  });

  it('mates fold into the loss so a missed mate is a blunder', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'a1a2', beforeMate: 2, beforeCp: null, afterCp: 200, afterMate: null });
    expect(j?.quality).toBe('blunder'); // before ~9800 vs 200
  });
});

describe('glyphs and wording', () => {
  it('has a glyph and label for every quality', () => {
    for (const q of ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const) {
      expect(QUALITY_GLYPHS[q].length).toBeGreaterThan(0);
    }
  });

  it('names the better move in explanations when known', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: -150 }) as MoveJudgement;
    const text = explainMove(j, 'Nf3');
    expect(text).toContain('Nf3');
  });

  it('best-move wording does not name another move', () => {
    const j = judge() as MoveJudgement;
    expect(explainMove(j, null)).toContain('top choice');
  });
});
