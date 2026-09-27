/**
 * Rating assessment: puzzle probe seeds a prior; staircase engine games converge RD.
 * Engine levels use Lichess-verified anchors: L1≈800, L2≈1000, L3≈1200, L4≈1400,
 * L5≈1500, L6≈1900, L7≈2300, L8≈2800.
 *
 * All ladder games are scored as ONE Glicko-2 rating period (batched recompute
 * from the prior after every game) — this avoids the sequential-update overshoot
 * that otherwise drags an all-losses run far below its true level.
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
  phase: 'puzzles' | 'games';
  puzzles: AssessmentPuzzle[];
  games: AssessmentGame[];
  matches: AssessmentMatch[];
  prior: { rating: number; rd: number } | null;
  currentLevel: number;
  lastDirection: 'up' | 'down' | null;
  done: boolean;
}

export const ASSESSMENT_MODE_INFO: Record<
  AssessmentMode,
  { title: string; detail: string }
> = {
  probe: {
    title: 'Puzzles + games (recommended)',
    detail: '8 puzzles seed a smart guess, then ~6-10 games pin it down. Best accuracy per minute.',
  },
  ladder: {
    title: 'Full ladder (~10-14 games)',
    detail: 'No puzzles — straight into a Stockfish staircase from level 3 (~1200). Most thorough.',
  },
  quick: {
    title: 'Quick scan (6 games)',
    detail: 'Six ladder games for a rough rating fast. Wider error bar (±150-200); re-run anytime.',
  },
};

export function newAssessment(mode: AssessmentMode = 'probe'): AssessmentState {
  return {
    mode,
    phase: mode === 'probe' ? 'puzzles' : 'games',
    puzzles: [],
    games: [],
    matches: [],
    prior: null,
    currentLevel: 2,
    lastDirection: null,
    done: false,
  };
}

/** Starting prior for ladder/quick modes (no puzzle probe to learn from). */
export const LADDER_DEFAULT_PRIOR = { rating: 1200, rd: 300 };

/** Prior estimate from the probe: median puzzle rating, adjusted by solve ratio. */
export function priorFromPuzzles(puzzles: AssessmentPuzzle[]): { rating: number; rd: number } {
  const done = puzzles.filter((p) => p.won !== undefined);
  if (done.length === 0) return { rating: 1200, rd: 260 };
  if (done.length >= 8 && done.every((p) => p.won && (p.score ?? 1) === 1)) {
    // Perfect probe: start higher; the games will correct from there.
    return { rating: 1600, rd: 260 };
  }
  const sorted = done.map((p) => p.rating).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const ratio = done.reduce((sum, p) => sum + Math.max(0, Math.min(1, p.score ?? (p.won ? 1 : 0))), 0) / done.length;
  const adj = (ratio - 0.5) * 500;
  return { rating: Math.max(600, Math.min(2200, median + adj)), rd: 260 };
}

/** Staircase: win → up one level; loss → down one; draws stay. */
export function nextLevel(s: AssessmentState): number {
  const games = s.games;
  if (games.length === 0) return s.currentLevel;
  const last = games[games.length - 1];
  if (last.result === 'draw') return s.currentLevel;
  if (last.result === 'win') return Math.min(ASSESSMENT_LEVELS.length - 1, s.currentLevel + 1);
  return Math.max(0, s.currentLevel - 1);
}

/**
 * Convergence depends on the mode:
 * - probe: RD < 150 with ≥ 8 games, cap 12
 * - ladder: RD < 150 with ≥ 8 games, cap 14 (thorough)
 * - quick: always done at 6 games (accept the wider error bar)
 */
export function assessmentDone(s: AssessmentState, rd: number): boolean {
  if (s.mode === 'quick') return s.games.length >= 6;
  if (s.mode === 'ladder') return s.games.length >= 14 || (s.games.length >= 8 && rd < 150);
  return s.games.length >= 12 || (s.games.length >= 8 && rd < 150);
}
