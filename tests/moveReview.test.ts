import { describe, expect, it } from 'vitest';
import {
  CLEAR_LOSS_CP,
  explainMove,
  judgeMove,
  QUALITY_GLYPHS,
  toCp,
  type MoveJudgement,
  type ParentLine,
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

  it('never faults the engine top choice even when the searches disagree', () => {
    // Played the move the engine recommended, but the child search came back
    // 1.2 pawns worse: that swing is search noise, not a player error.
    const j = judge({ playedUci: 'g1f3', bestUci: 'g1f3', afterCp: -90 });
    expect(j?.quality).toBe('best');
    expect(j?.lossCp).toBe(0);
  });

  it('never faults the engine top choice for black either', () => {
    const j = judge({ mover: 'b', playedUci: 'g8f6', bestUci: 'g8f6', beforeCp: -20, afterCp: 100 });
    expect(j?.quality).toBe('best');
    expect(j?.lossCp).toBe(0);
  });

  it('still faults a different move by the same swing', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: -90 });
    expect(j?.quality).toBe('mistake'); // loss 120
  });

  it('rates a small eval drop as good when the best move differs', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: 10 });
    expect(j?.quality).toBe('good');
  });

  it('treats a gap the engine itself considers near-equal as good', () => {
    // The lite engine ranks practically equal opening moves ~30-45cp apart.
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: -10 }); // loss 40
    expect(j?.quality).toBe('good');
  });

  it('band edges: loss 50 is good, 51 an inaccuracy, 100 mistake, 251 blunder', () => {
    expect(judge({ playedUci: 'a2a3', afterCp: -20 })?.quality).toBe('good'); // loss 50
    expect(judge({ playedUci: 'a2a3', afterCp: -21 })?.quality).toBe('inaccuracy'); // loss 51
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

describe('same-search grading (the engine\'s own top lines)', () => {
  // The engine (lite, 1s) evaluates two separate positions inconsistently by a
  // pawn or more, while its own top lines sit within ~25cp of each other. So a
  // move that is one of those lines must be graded from the line spread, not
  // from a second search of the resulting position.
  const lines: ParentLine[] = [
    { uci: 'e7e6', cp: 5, mate: null },
    { uci: 'd7d5', cp: 9, mate: null },
    { uci: 'c7c6', cp: 28, mate: null },
  ];

  it('grades a listed move from the line spread even when the child search is way off', () => {
    // Cross-search says black gave up 120cp; the same search says 4cp.
    const j = judge({
      mover: 'b',
      playedUci: 'd7d5',
      bestUci: 'e7e6',
      beforeCp: 0,
      afterCp: 120,
      lines,
      noiseFloorCp: CLEAR_LOSS_CP,
    });
    expect(j?.quality).toBe('good');
    expect(j?.lossCp).toBe(4);
    expect(j?.basis).toBe('lines');
  });

  it('reports the line the played move belongs to, not the child search', () => {
    const j = judge({
      mover: 'b',
      playedUci: 'c7c6',
      bestUci: 'e7e6',
      beforeCp: 0,
      afterCp: 300,
      lines,
      noiseFloorCp: CLEAR_LOSS_CP,
    });
    expect(j?.lossCp).toBe(23); // 28 - 5
    expect(j?.quality).toBe('good');
    expect(j?.afterCp).toBe(28);
  });

  it('rates the first line as best', () => {
    const j = judge({ mover: 'b', playedUci: 'e7e6', bestUci: 'e7e6', lines });
    expect(j?.quality).toBe('best');
    expect(j?.basis).toBe('lines');
  });

  it('does not fault a move outside the lines for a small cross-search gap', () => {
    const j = judge({
      mover: 'b',
      playedUci: 'g7g6',
      bestUci: 'e7e6',
      beforeCp: 0,
      afterCp: 120,
      lines,
      noiseFloorCp: CLEAR_LOSS_CP,
    });
    expect(j?.quality).toBe('good');
    expect(j?.basis).toBe('search');
  });

  it('still faults a move outside the lines for a clear loss', () => {
    const j = judge({
      mover: 'b',
      playedUci: 'g7g6',
      bestUci: 'e7e6',
      beforeCp: 0,
      afterCp: 400,
      lines,
      noiseFloorCp: CLEAR_LOSS_CP,
    });
    expect(j?.quality).toBe('blunder');
    expect(j?.lossCp).toBe(400);
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

  it('shows the eval swing for mistakes so the verdict is checkable', () => {
    const j = judge({ playedUci: 'a2a3', bestUci: 'g1f3', afterCp: -90 }) as MoveJudgement;
    const text = explainMove(j, 'Nf3');
    expect(text).toContain('1.2 pawns');
    expect(text).toContain('(+0.3 → -0.9)');
  });

  it('does not quote rough cross-search evals as a precise swing', () => {
    const j = judge({
      mover: 'b',
      playedUci: 'g7g6',
      bestUci: 'e7e6',
      beforeCp: 0,
      afterCp: 120,
      lines: [{ uci: 'e7e6', cp: 5, mate: null }],
      noiseFloorCp: CLEAR_LOSS_CP,
    }) as MoveJudgement;
    const text = explainMove(j, 'e6');
    expect(text).toContain('Close to the engine');
    expect(text).not.toContain('→');
  });

  it('best-move wording does not name another move', () => {
    const j = judge() as MoveJudgement;
    expect(explainMove(j, null)).toContain('top choice');
  });
});
