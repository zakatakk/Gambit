import { describe, expect, it } from 'vitest';
import { ratingToStrength, ASSESSMENT_LEVELS } from '../src/engineStrength';

describe('ratingToStrength', () => {
  it('is monotonically increasing in skill', () => {
    let prev = -1;
    for (let r = 600; r <= 2900; r += 50) {
      const s = ratingToStrength(r, 'full');
      expect(s.skill).toBeGreaterThanOrEqual(prev);
      prev = s.skill;
    }
  });

  it('maps Lichess anchor levels into sane bands', () => {
    expect(ratingToStrength(800, 'lite').skill).toBeLessThanOrEqual(1);
    expect(ratingToStrength(1500, 'full').skill).toBe(3);
    expect(ratingToStrength(1900, 'full').skill).toBeLessThanOrEqual(8);
    expect(ratingToStrength(2300, 'full').skill).toBeGreaterThanOrEqual(12);
    expect(ratingToStrength(2800, 'full').skill).toBe(20);
  });

  it('clamps lite tier to its cap', () => {
    const s = ratingToStrength(2900, 'lite');
    expect(s.limitedElo ?? 0).toBeLessThanOrEqual(2350);
  });

  it('weak ratings get randomization, strong do not', () => {
    expect(ratingToStrength(900, 'full').randomCp).toBeGreaterThan(0);
    expect(ratingToStrength(2700, 'full').randomCp).toBe(0);
  });

  it('has 8 assessment levels matching Lichess anchors', () => {
    expect(ASSESSMENT_LEVELS).toHaveLength(8);
    expect(ASSESSMENT_LEVELS[0].rating).toBe(800);
    expect(ASSESSMENT_LEVELS[7].rating).toBe(2800);
  });
});
