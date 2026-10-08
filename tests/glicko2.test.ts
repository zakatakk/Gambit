import { describe, expect, it } from 'vitest';
import { rate, ratePeriod, growRd } from '../src/glicko2';

describe('glicko2', () => {
  // Glickman's "Example of the Glicko-2 system" worked example:
  // Player 1500/200/0.06 plays 1400/30 (W), 1550/100 (L), 1700/300 (L).
  // Paper result: r' = 1464.06, RD' = 151.52, sigma' = 0.05999.
  it('matches the paper worked example', () => {
    const out = rate(
      { rating: 1500, rd: 200, volatility: 0.06, lastPlayed: 0 },
      [
        { oppRating: 1400, oppRd: 30, score: 1 },
        { oppRating: 1550, oppRd: 100, score: 0 },
        { oppRating: 1700, oppRd: 300, score: 0 },
      ],
      0
    );
    expect(out.rating).toBeCloseTo(1464.06, 0);
    expect(out.rd).toBeCloseTo(151.52, 0);
    expect(out.volatility).toBeCloseTo(0.05999, 3);
  });

  it('single win vs 1400/30 moves rating up ~60 with tighter RD', () => {
    const out = rate(
      { rating: 1500, rd: 200, volatility: 0.06, lastPlayed: 0 },
      [{ oppRating: 1400, oppRd: 30, score: 1 }],
      0
    );
    expect(out.rating).toBeGreaterThan(1540);
    expect(out.rating).toBeLessThan(1590);
    expect(out.rd).toBeLessThan(200);
  });

  it('single loss vs 1400/30 moves rating down', () => {
    const out = rate(
      { rating: 1500, rd: 200, volatility: 0.06, lastPlayed: 0 },
      [{ oppRating: 1400, oppRd: 30, score: 0 }],
      0
    );
    expect(out.rating).toBeLessThan(1465);
  });

  it('shrinks RD as evidence accumulates', () => {
    // Ten games in one rating period: RD shrinks without inactivity growth.
    const matches = Array.from({ length: 10 }, (_, i) => ({
      oppRating: 1500,
      oppRd: 150,
      score: i % 3 === 0 ? 1 : 0,
    }));
    const s = ratePeriod({ rating: 1500, rd: 350, volatility: 0.06, lastPlayed: 0 }, matches, 0);
    expect(s.rd).toBeLessThan(120);
  });

  it('grows RD toward 350 with inactivity', () => {
    const now = Date.now();
    const out = growRd(
      { rating: 1500, rd: 60, volatility: 0.06, lastPlayed: now - 120 * 86_400_000 },
      now
    );
    expect(out).toBeGreaterThan(330);
    expect(out).toBeLessThanOrEqual(350);
  });
});
