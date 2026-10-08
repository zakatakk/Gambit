import { describe, expect, it } from 'vitest';
import {
  matchesPuzzleMove,
  PUZZLE_TRY_LIMIT,
  puzzleScoreForMistakes,
  puzzleSolutionSan,
} from '../src/puzzleScoring';

describe('puzzleScoring', () => {
  it('awards progressively less credit after mistakes, then none after three misses', () => {
    expect(PUZZLE_TRY_LIMIT).toBe(3);
    expect(puzzleScoreForMistakes(0)).toBe(1);
    expect(puzzleScoreForMistakes(1)).toBe(0.75);
    expect(puzzleScoreForMistakes(2)).toBe(0.5);
    expect(puzzleScoreForMistakes(3)).toBe(0);
  });

  it('permits moving on as soon as a puzzle is successfully solved', () => {
    expect(puzzleScoreForMistakes(0)).toBeGreaterThan(0);
    expect(puzzleScoreForMistakes(1)).toBeGreaterThan(0);
    expect(puzzleScoreForMistakes(2)).toBeGreaterThan(0);
    expect(puzzleScoreForMistakes(PUZZLE_TRY_LIMIT)).toBe(0);
  });

  it('rejects negative or fractional mistake counts', () => {
    expect(() => puzzleScoreForMistakes(-1)).toThrow(RangeError);
    expect(() => puzzleScoreForMistakes(1.5)).toThrow(RangeError);
  });

  it('matches source and promotion moves correctly', () => {
    expect(matchesPuzzleMove({ from: 'e2', to: 'e4' }, 'e2e4')).toBe(true);
    expect(matchesPuzzleMove({ from: 'e2', to: 'e3' }, 'e2e4')).toBe(false);
    expect(matchesPuzzleMove({ from: 'a7', to: 'a8', promotion: 'q' }, 'a7a8q')).toBe(true);
    expect(matchesPuzzleMove({ from: 'a7', to: 'a8', promotion: 'n' }, 'a7a8q')).toBe(false);
    expect(matchesPuzzleMove({ from: 'a7', to: 'a8' }, undefined)).toBe(false);
  });

  it('converts a UCI line into SAN with move numbers', () => {
    expect(
      puzzleSolutionSan(
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        ['e2e4', 'e7e5', 'g1f3']
      )
    ).toBe('1. e4 e5 2. Nf3');
  });
});
