/**
 * Rating assessment: puzzle probe seeds a prior; staircase engine games converge RD.
 * Engine levels use Lichess-verified anchors: L1≈800, L2≈1000, L3≈1200, L4≈1400,
 * L5≈1500, L6≈1900, L7≈2300, L8≈2800.
 *
 * Ladder games are recomputed as a single Glicko-2 period from the prior to avoid
 * sequential-update overshoot when a run contains repeated wins or losses.
 */
import { ASSESSMENT_LEVELS } from './engineStrength';
import type { PuzzleScore } from './puzzleScoring';
import type { PuzzleItem } from './types';

export interface AssessmentPuzzle extends PuzzleItem {
  won?: boolean;
  score?: PuzzleScore;
  mistakes?: number;
}

export interface AssessmentGame {
  level: number;
  result: 'win' | 'loss' | 'draw';
}

export interface AssessmentMatch {
  oppRating: number;
  score: 0 | 0.5 | 1;
}

export type AssessmentMode = 'probe' | 'ladder' | 'quick';

export interface AssessmentState {
  mode: AssessmentMode;
  puzzles: AssessmentPuzzle[];
  games: AssessmentGame[];
  matches: AssessmentMatch[];
  prior: { rating: number; rd: number } | null;
  currentLevel: number;
}

export function newAssessment(mode: AssessmentMode = 'probe'): AssessmentState {
  return {
    mode,
    puzzles: [],
    games: [],
    matches: [],
    prior: null,
    currentLevel: 2,
  };
}

/** Starting prior for ladder/quick modes (no puzzle probe to learn from). */
export const LADDER_DEFAULT_PRIOR = { rating: 1200, rd: 300 };

/** Prior estimate from the probe: median puzzle rating, adjusted by solve ratio. */
export function priorFromPuzzles(puzzles: AssessmentPuzzle[]): { rating: number; rd: number } {
  const done = puzzles.filter((puzzle) => puzzle.won !== undefined);
  if (done.length === 0) return { rating: 1200, rd: 260 };
  if (done.length >= 8 && done.every((puzzle) => puzzle.won && (puzzle.score ?? 1) === 1)) {
    return { rating: 1600, rd: 260 };
  }
  const sortedRatings = done.map((puzzle) => puzzle.rating).sort((a, b) => a - b);
  const mid = Math.floor(sortedRatings.length / 2);
  const median = sortedRatings.length % 2
    ? sortedRatings[mid]
    : (sortedRatings[mid - 1] + sortedRatings[mid]) / 2;
  const ratio = done.reduce(
    (sum, puzzle) => sum + Math.max(0, Math.min(1, puzzle.score ?? (puzzle.won ? 1 : 0))),
    0
  ) / done.length;
  return { rating: Math.max(600, Math.min(2200, median + (ratio - 0.5) * 500)), rd: 260 };
}

/** Staircase: win → up one level; loss → down one; draws stay. */
export function nextLevel(state: AssessmentState): number {
  const lastGame = state.games[state.games.length - 1];
  if (!lastGame || lastGame.result === 'draw') return state.currentLevel;
  if (lastGame.result === 'win') return Math.min(ASSESSMENT_LEVELS.length - 1, state.currentLevel + 1);
  return Math.max(0, state.currentLevel - 1);
}

/** Convergence caps: quick=6 games, probe=12, ladder=14; standard modes may stop at RD <150 after 8. */
export function assessmentDone(state: AssessmentState, rd: number): boolean {
  if (state.mode === 'quick') return state.games.length >= 6;
  const cap = state.mode === 'ladder' ? 14 : 12;
  return state.games.length >= cap || (state.games.length >= 8 && rd < 150);
}
