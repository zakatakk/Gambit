import { describe, expect, it } from 'vitest';
import { winPct, classify, moveAccuracy, aggregateAccuracy, winDrop, phaseSpans, DEFAULT_THRESHOLDS } from '../src/reviewScoring';

describe('reviewScoring', () => {
  it('winPct: equal position is 50%', () => {
    expect(winPct(0)).toBeCloseTo(50, 5);
  });

  it('winPct: +500cp is dominant, -500 near-lost, symmetric', () => {
    expect(winPct(500)).toBeGreaterThan(85);
    expect(winPct(-500)).toBeLessThan(15);
    expect(winPct(500) + winPct(-500)).toBeCloseTo(100, 3);
  });

  it('winPct: monotonic in cp', () => {
    let prev = -1;
    for (const cp of [-800, -400, -100, 0, 100, 400, 800]) {
      expect(winPct(cp)).toBeGreaterThan(prev);
      prev = winPct(cp);
    }
  });

  it('equal-position blunder classifies as blunder by win drop', () => {
    // Hanging the queen from equal: ~-900cp swing
    const m = {
      before: { cp: 30, mate: null },
      after: { cp: -900, mate: null },
      best: { cp: 30, mate: null },
    };
    const drop = winDrop(m, true);
    expect(drop).toBeGreaterThan(DEFAULT_THRESHOLDS.blunder);
    expect(classify(drop, false)).toBe('blunder');
  });

  it('playing the best move classifies as best even in wild positions', () => {
    const m = {
      before: { cp: 100, mate: null },
      after: { cp: 100, mate: null },
      best: { cp: 100, mate: null },
    };
    expect(classify(winDrop(m, true), true)).toBe('best');
  });

  it('small drop is good, mid is mistake-range by real stakes', () => {
    const small = { before: { cp: 0, mate: null }, after: { cp: -40, mate: null }, best: { cp: 0, mate: null } };
    expect(classify(winDrop(small, true), false)).toBe('good');
    const mid = { before: { cp: 0, mate: null }, after: { cp: -150, mate: null }, best: { cp: 0, mate: null } };
    const cls = classify(winDrop(mid, true), false);
    expect(['inaccuracy', 'mistake']).toContain(cls);
  });

  it('win% drop is stakes-aware: losing 100cp from +600 barely registers', () => {
    const m = { before: { cp: 600, mate: null }, after: { cp: 500, mate: null }, best: { cp: 600, mate: null } };
    expect(winDrop(m, true)).toBeLessThan(4);
  });

  it('moveAccuracy: no drop ≈ 100, huge drop ≈ low', () => {
    expect(moveAccuracy(50, 50)).toBeGreaterThan(99);
    expect(moveAccuracy(50, 5)).toBeLessThan(50);
  });

  it('aggregateAccuracy lands in 0-100 and punishes blunders', () => {
    const clean = Array.from({ length: 30 }, () => ({ before: 50, after: 50 }));
    const sloppy = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? { before: 50, after: 10 } : { before: 50, after: 48 }));
    const a1 = aggregateAccuracy(clean);
    const a2 = aggregateAccuracy(sloppy);
    expect(a1).toBeGreaterThan(90);
    expect(a2).toBeLessThan(a1);
  });

  it('phaseSpans: opening → middlegame → endgame by piece count', () => {
    // 32 pieces falling to 10 across 20 plies
    const counts = Array.from({ length: 20 }, (_, i) => Math.max(10, 32 - i * 1.5 | 0));
    const spans = phaseSpans(counts);
    expect(spans[0].name).toBe('opening');
    expect(spans[spans.length - 1].name).toBe('endgame');
    expect(spans[spans.length - 1].toPly).toBe(20);
  });
});
