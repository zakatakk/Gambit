import { describe, expect, it } from 'vitest';
import { rate, ratePeriod } from '../src/glicko2';
import {
  priorFromPuzzles,
  nextLevel,
  assessmentDone,
  newAssessment,
  LADDER_DEFAULT_PRIOR,
} from '../src/assessment';

/** Mirrors the ladder's batched recompute: every game re-scored from the prior. */
function batchedLadder(prior: { rating: number; rd: number }, scores: (0 | 0.5 | 1)[], oppRatings: number[]) {
  const matches = scores.map((score, i) => ({ oppRating: oppRatings[i], oppRd: 60, score }));
  return rate({ rating: prior.rating, rd: prior.rd, volatility: 0.06, lastPlayed: 0 }, matches, 0);
}

describe('Glicko-2', () => {
  it('matches Glickman’s published example', () => {
    const result = rate({
      rating: 1500,
      rd: 200,
      volatility: 0.06,
      lastPlayed: 0,
    }, [
      { oppRating: 1400, oppRd: 30, score: 1 },
      { oppRating: 1550, oppRd: 100, score: 0 },
      { oppRating: 1700, oppRd: 300, score: 0 },
    ], 0);

    // The exact implementation result is 1464.05067; the paper rounds this
    // to 1464.06 while some independent implementations retain the exact value.
    expect(result.rating).toBeCloseTo(1464.05067, 4);
    expect(result.rd).toBeCloseTo(151.51652, 4);
    expect(result.volatility).toBeCloseTo(0.059996, 5);
  });

  it('validates inputs rather than returning a poisoned rating', () => {
    const state = { rating: 1500, rd: 200, volatility: 0.06, lastPlayed: 0 };
    expect(() => rate(state, [{ oppRating: 1500, oppRd: 60, score: 2 }], 0)).toThrow(RangeError);
    expect(() => rate(state, [{ oppRating: 1500, oppRd: 0, score: 0.5 }], 0)).toThrow(RangeError);
    expect(() => rate({ ...state, volatility: Number.NaN }, [], 0)).toThrow(RangeError);
  });

  it('supports assessment batches as one rating period', () => {
    const prior = { rating: 1200, rd: 300, volatility: 0.06, lastPlayed: 0 };
    const matches = [
      { oppRating: 1200, oppRd: 60, score: 1 },
      { oppRating: 1400, oppRd: 60, score: 0 },
    ] as const;
    expect(ratePeriod(prior, [...matches], 0)).toEqual(rate(prior, [...matches], 0));
    expect(ratePeriod(prior, [], 0)).toEqual({ ...prior, lastPlayed: 0 });
  });
});

describe('assessment', () => {
  it('all-losses run drops far below the prior with tight RD (true performance)', () => {
    const prior = { rating: 1378, rd: 260 };
    const opps = [1200, 1000, 1000, 800, 800, 800, 800, 800, 800, 800, 800, 800];
    const out = batchedLadder(prior, Array(12).fill(0), opps);
    // Losing everything (incl. 9 games vs the 800 level) measures far below 800 —
    // the app floors this at 600 and caps RD at 200; raw math confirms direction.
    expect(out.rating).toBeLessThan(950);
    expect(out.rd).toBeLessThan(200);
  });

  it('perfect run converges high', () => {
    const prior = { rating: 1600, rd: 260 };
    const opps = [1200, 1400, 1400, 1500, 1500, 1900, 1900, 1900];
    const out = batchedLadder(prior, Array(8).fill(1), opps);
    expect(out.rating).toBeGreaterThan(1900);
    expect(out.rd).toBeLessThan(150);
  });

  it('mixed 50% run converges near the prior', () => {
    const prior = { rating: 1400, rd: 260 };
    const opps = [1400, 1400, 1400, 1400, 1400, 1400, 1400, 1400];
    const scores: (0 | 1)[] = [1, 0, 1, 0, 1, 0, 1, 0];
    const out = batchedLadder(prior, scores, opps);
    expect(Math.abs(out.rating - 1400)).toBeLessThan(120);
  });

  it('probe prior reacts to solve ratio', () => {
    const puzzles = [
      { rating: 1200 }, { rating: 1300 }, { rating: 1400 }, { rating: 1500 },
      { rating: 1200 }, { rating: 1300 }, { rating: 1400 }, { rating: 1500 },
    ].map((p, i) => ({ id: String(i), fen: '', moves: [], rd: 80, popularity: 90, themes: [], ...p, won: i < 6 }));
    const prior = priorFromPuzzles(puzzles as never);
    // 6/8 solved → above the median (1350)
    expect(prior.rating).toBeGreaterThan(1350);
  });

  it('probe prior incorporates partial credit from recovered puzzles', () => {
    const puzzles = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      fen: '',
      moves: [],
      rating: 1400,
      rd: 80,
      popularity: 90,
      themes: [],
      won: true,
      score: (i < 4 ? 0.75 : 1) as 0.75 | 1,
    }));
    const prior = priorFromPuzzles(puzzles);
    expect(prior.rating).toBe(1400 + ((7 / 8 - 0.5) * 500));
    expect(prior.rating).toBeLessThan(1600);
  });

  it('a partial-credit perfect streak does not use the perfect-probe bonus', () => {
    const puzzles = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      fen: '',
      moves: [],
      rating: 1400,
      rd: 80,
      popularity: 90,
      themes: [],
      won: true,
      score: (i === 0 ? 0.75 : 1) as 0.75 | 1,
    }));
    expect(priorFromPuzzles(puzzles).rating).toBeLessThan(1650);
  });

  it('staircase moves down on loss, up on win, stays on draw', () => {
    const s = newAssessment();
    s.currentLevel = 2;
    s.games.push({ level: 2, result: 'loss' });
    s.currentLevel = nextLevel(s);
    expect(s.currentLevel).toBe(1);
    s.games.push({ level: 1, result: 'win' });
    s.currentLevel = nextLevel(s);
    expect(s.currentLevel).toBe(2);
    s.games.push({ level: 2, result: 'draw' });
    s.currentLevel = nextLevel(s);
    expect(s.currentLevel).toBe(2);
  });

  it('done when 8+ games and RD < 150, or 12 games cap (probe mode)', () => {
    const s = newAssessment('probe');
    s.games = Array(8).fill({ level: 0, result: 'loss' as const });
    expect(assessmentDone(s, 160)).toBe(false);
    expect(assessmentDone(s, 140)).toBe(true);
    s.games = Array(12).fill({ level: 0, result: 'loss' as const });
    expect(assessmentDone(s, 200)).toBe(true);
  });

  it('quick mode: exactly 6 games, RD irrelevant', () => {
    const s = newAssessment('quick');
    s.games = Array(5).fill({ level: 0, result: 'draw' as const });
    expect(assessmentDone(s, 100)).toBe(false);
    s.games = Array(6).fill({ level: 0, result: 'draw' as const });
    expect(assessmentDone(s, 350)).toBe(true);
  });

  it('ladder mode: up to 14 games, converges at 8 with low RD', () => {
    const s = newAssessment('ladder');
    s.games = Array(8).fill({ level: 0, result: 'draw' as const });
    expect(assessmentDone(s, 160)).toBe(false);
    expect(assessmentDone(s, 140)).toBe(true);
    s.games = Array(14).fill({ level: 0, result: 'draw' as const });
    expect(assessmentDone(s, 300)).toBe(true);
  });

  it('ladder/quick default prior is 1200 ±300', () => {
    expect(LADDER_DEFAULT_PRIOR.rating).toBe(1200);
    expect(LADDER_DEFAULT_PRIOR.rd).toBe(300);
    expect(newAssessment('ladder').mode).toBe('ladder');
    expect(newAssessment('quick').mode).toBe('quick');
  });
});
