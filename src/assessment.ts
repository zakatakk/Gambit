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

/** Saved-assessment snapshot format. Bump the version whenever the shape changes. */
const SAVED_ASSESSMENT_VERSION = 1;

export interface SavedAssessment {
  version: typeof SAVED_ASSESSMENT_VERSION;
  mode: AssessmentMode;
  prior: { rating: number; rd: number } | null;
  currentLevel: number;
  puzzles: { id: string; won?: boolean; score?: number; mistakes?: number }[];
  games: AssessmentGame[];
  matches: AssessmentMatch[];
}

const PUZZLE_SCORES = [0, 0.5, 0.75, 1];

const BLANK_PUZZLE: PuzzleItem = {
  id: '', fen: '', moves: [], rating: 0, rd: 0, popularity: 0, themes: [],
};

/** Snapshot an in-progress assessment for storage between sessions. */
export function serializeAssessment(state: AssessmentState): SavedAssessment {
  return {
    version: SAVED_ASSESSMENT_VERSION,
    mode: state.mode,
    prior: state.prior ? { ...state.prior } : null,
    currentLevel: state.currentLevel,
    puzzles: state.puzzles.map((puzzle) => ({
      id: puzzle.id,
      won: puzzle.won,
      score: puzzle.score,
      mistakes: puzzle.mistakes,
    })),
    games: state.games.map((game) => ({ ...game })),
    matches: state.matches.map((match) => ({ ...match })),
  };
}

/** Restore a saved assessment; returns null for unknown, incomplete, or corrupt snapshots. */
export function deserializeAssessment(raw: SavedAssessment | null | undefined): AssessmentState | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== SAVED_ASSESSMENT_VERSION) return null;
  if (raw.mode !== 'probe' && raw.mode !== 'ladder' && raw.mode !== 'quick') return null;

  const state = newAssessment(raw.mode);
  if (raw.prior !== null) {
    const prior = raw.prior as { rating?: unknown; rd?: unknown } | null;
    if (!prior || !Number.isFinite(prior.rating) || !Number.isFinite(prior.rd)) return null;
    state.prior = { rating: prior.rating as number, rd: prior.rd as number };
  }
  if (Number.isInteger(raw.currentLevel) && raw.currentLevel >= 0 && raw.currentLevel < ASSESSMENT_LEVELS.length) {
    state.currentLevel = raw.currentLevel;
  }

  if (raw.puzzles !== undefined) {
    if (!Array.isArray(raw.puzzles)) return null;
    for (const entry of raw.puzzles) {
      if (!entry || typeof entry.id !== 'string') return null;
      const puzzle: AssessmentPuzzle = { ...BLANK_PUZZLE, id: entry.id };
      if (typeof entry.won === 'boolean') puzzle.won = entry.won;
      if (typeof entry.score === 'number' && PUZZLE_SCORES.includes(entry.score)) {
        puzzle.score = entry.score as PuzzleScore;
      }
      if (Number.isInteger(entry.mistakes) && (entry.mistakes as number) >= 0) puzzle.mistakes = entry.mistakes;
      state.puzzles.push(puzzle);
    }
  }

  if (raw.games !== undefined) {
    if (!Array.isArray(raw.games)) return null;
    for (const game of raw.games) {
      if (!game || !Number.isInteger(game.level) || !['win', 'loss', 'draw'].includes(game.result)) return null;
      state.games.push({ level: game.level, result: game.result });
    }
  }

  if (raw.matches !== undefined) {
    if (!Array.isArray(raw.matches)) return null;
    for (const match of raw.matches) {
      if (!match || !Number.isFinite(match.oppRating) || ![0, 0.5, 1].includes(match.score)) return null;
      state.matches.push({ oppRating: match.oppRating, score: match.score as 0 | 0.5 | 1 });
    }
  }
  return state;
}
