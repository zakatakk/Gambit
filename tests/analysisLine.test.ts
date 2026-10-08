import { describe, expect, it } from 'vitest';
import { AnalysisLine, evalFraction, formatEval } from '../src/analysisLine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E4_C5 = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1';

describe('AnalysisLine', () => {
  it('starts at the root position with no last move', () => {
    const line = new AnalysisLine(START);
    expect(line.index).toBe(0);
    expect(line.currentFen()).toBe(START);
    expect(line.lastMove()).toBeNull();
  });

  it('pushes moves and tracks the cursor and last move', () => {
    const line = new AnalysisLine(START);
    line.push({ san: 'e4', uci: 'e2e4', fen: AFTER_E4 });
    line.push({ san: 'c5', uci: 'c7c5', fen: AFTER_E4_C5 });
    expect(line.index).toBe(2);
    expect(line.currentFen()).toBe(AFTER_E4_C5);
    expect(line.lastMove()).toEqual({ from: 'c7', to: 'c5' });
  });

  it('navigates to any ply and clamps out-of-range requests', () => {
    const line = new AnalysisLine(START);
    line.push({ san: 'e4', uci: 'e2e4', fen: AFTER_E4 });
    line.push({ san: 'c5', uci: 'c7c5', fen: AFTER_E4_C5 });
    expect(line.goTo(1)).toBe(true);
    expect(line.currentFen()).toBe(AFTER_E4);
    expect(line.lastMove()).toEqual({ from: 'e2', to: 'e4' });
    expect(line.goTo(-5)).toBe(true);
    expect(line.index).toBe(0);
    expect(line.goTo(99)).toBe(true);
    expect(line.index).toBe(2);
    expect(line.goTo(2)).toBe(false);
  });

  it('playing from an earlier ply replaces the moves after it', () => {
    const line = new AnalysisLine(START);
    line.push({ san: 'e4', uci: 'e2e4', fen: AFTER_E4 });
    line.push({ san: 'c5', uci: 'c7c5', fen: AFTER_E4_C5 });
    line.goTo(1);
    line.push({ san: 'd4', uci: 'd2d4', fen: AFTER_D4 });
    expect(line.list.map((m) => m.san)).toEqual(['e4', 'd4']);
    expect(line.index).toBe(2);
    expect(line.currentFen()).toBe(AFTER_D4);
  });

  it('reset starts a new root and drops the old moves', () => {
    const line = new AnalysisLine(START);
    line.push({ san: 'e4', uci: 'e2e4', fen: AFTER_E4 });
    line.reset(AFTER_D4);
    expect(line.rootFen).toBe(AFTER_D4);
    expect(line.list).toHaveLength(0);
    expect(line.index).toBe(0);
    expect(line.currentFen()).toBe(AFTER_D4);
  });
});

describe('formatEval', () => {
  it('formats centipawns from White as pawns', () => {
    expect(formatEval(40, null)).toBe('+0.4');
    expect(formatEval(-250, null)).toBe('-2.5');
    expect(formatEval(0, null)).toBe('0.0');
    expect(formatEval(4, null)).toBe('0.0');
  });

  it('formats mates with a sign for the side that mates', () => {
    expect(formatEval(null, 3)).toBe('M3');
    expect(formatEval(null, -2)).toBe('-M2');
  });

  it('returns an empty string when there is no eval', () => {
    expect(formatEval(null, null)).toBe('');
  });
});

describe('evalFraction', () => {
  it('is half at equal material and clamps at +-10 pawns', () => {
    expect(evalFraction(0, null)).toBe(0.5);
    expect(evalFraction(2000, null)).toBe(1);
    expect(evalFraction(-5000, null)).toBe(0);
    expect(evalFraction(400, null)).toBeCloseTo(0.7);
  });

  it('is full or empty for mates', () => {
    expect(evalFraction(null, 4)).toBe(1);
    expect(evalFraction(null, -1)).toBe(0);
  });
});
