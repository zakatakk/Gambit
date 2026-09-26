import { describe, expect, it } from 'vitest';
import { rate } from '../src/glicko2';
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
    const s = newAssessment('ladder');
    expect(s.phase).toBe('games');
    const q = newAssessment('quick');
    expect(q.phase).toBe('games');
  });
});
