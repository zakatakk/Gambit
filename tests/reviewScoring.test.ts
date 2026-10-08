import { describe, expect, it } from 'vitest';
import { aggregateAccuracy, mateScoreValue, moveAccuracy, winPct } from '../src/reviewScoring';

describe('review scoring', () => {
  it('converts signed mate scores from White’s perspective', () => {
    expect(mateScoreValue(1)).toBe(99.5);
    expect(mateScoreValue(-1)).toBe(0.5);
    expect(mateScoreValue(20)).toBe(85);
    expect(mateScoreValue(-20)).toBe(15);
  });

  it('gives perfect accuracy when win chances do not decrease', () => {
    expect(moveAccuracy(50, 60)).toBe(100);
    expect(aggregateAccuracy([{ before: 50, after: 50 }])).toBe(100);
  });

  it('aggregates each player’s accuracies with shared game volatility windows', () => {
    const positions = [50, 51, 52, 49, 50, 48, 52, 50, 51, 49, 50, 52, 47, 50, 48, 50, 52, 50, 49, 51, 50];
    const whitePairs = Array.from({ length: 10 }, (_, index) => ({
      before: positions[index * 2],
      after: positions[index * 2 + 1],
    }));
    const blackPairs = Array.from({ length: 10 }, (_, index) => ({
      before: 100 - positions[index * 2 + 1],
      after: 100 - positions[index * 2 + 2],
    }));
    expect(aggregateAccuracy(whitePairs, positions, Array.from({ length: 10 }, (_, i) => i * 2))).toBeGreaterThan(90);
    expect(aggregateAccuracy(blackPairs, positions.map((value) => 100 - value), Array.from({ length: 10 }, (_, i) => i * 2 + 1))).toBeGreaterThan(90);
  });

  it('uses end-of-game win chance rather than raw centipawns for mates', () => {
    expect(winPct(1000)).toBeGreaterThan(97);
    expect(mateScoreValue(1)).toBeLessThan(100);
  });
});
