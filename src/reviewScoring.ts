/** Win-probability move scoring, classifications, and game accuracy. */

export type MoveCls = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** White's expected score (0-100) from a white-perspective centipawn evaluation. */
export function winPct(cpWhitePov: number): number {
  const v = 2 / (1 + Math.exp(-0.00368208 * cpWhitePov)) - 1;
  return 50 + 50 * v;
}

/** Result points for a mate value expressed as winning-side plies to mate. */
export function mateScoreValue(mate: number): number {
  const percent = Math.max(85, 99.5 - (Math.abs(mate) - 1));
  return mate > 0 ? percent : 100 - percent;
}

export interface MoveEval {
  before: { cp: number | null; mate: number | null };
  after: { cp: number | null; mate: number | null };
  best: { cp: number | null; mate: number | null };
}

function scoreWinPercent(score: MoveEval['before']): number {
  if (score.mate !== null) return mateScoreValue(score.mate);
  return winPct(score.cp ?? 0);
}

/** Win percentage the mover gave up versus best play, from the mover's perspective. */
export function winDrop(move: MoveEval, moverIsWhite: boolean): number {
  const before = scoreWinPercent(move.best);
  const after = scoreWinPercent(move.after);
  return Math.max(0, (moverIsWhite ? before : 100 - before) - (moverIsWhite ? after : 100 - after));
}

export interface ClassifyThresholds {
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

const DEFAULT_THRESHOLDS: ClassifyThresholds = { inaccuracy: 6, mistake: 12, blunder: 20 };

export function classify(drop: number, playedIsBest: boolean, thresholds: ClassifyThresholds = DEFAULT_THRESHOLDS): MoveCls {
  if (playedIsBest || drop < 2) return 'best';
  if (drop >= thresholds.blunder) return 'blunder';
  if (drop >= thresholds.mistake) return 'mistake';
  if (drop >= thresholds.inaccuracy) return 'inaccuracy';
  return 'good';
}

/** Per-move accuracy from mover-perspective win percentages. */
export function moveAccuracy(beforePov: number, afterPov: number): number {
  if (afterPov >= beforePov) return 100;
  const winDrop = beforePov - afterPov;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDrop) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

function windowStdev(prefixSum: number[], prefixSquares: number[], start: number, size: number): number {
  const end = start + size;
  const sum = prefixSum[end] - prefixSum[start];
  const sumSquares = prefixSquares[end] - prefixSquares[start];
  const mean = sum / size;
  return Math.sqrt(Math.max(0, sumSquares / size - mean * mean));
}

/**
 * Aggregate move accuracy using Lichess's volatility-weighted and harmonic means.
 * `winPercentSeries` contains every position in the relevant game/phase; indices
 * locate this player's moves in that full sequence, including opponent turns.
 */
export function aggregateAccuracy(
  pairs: { before: number; after: number }[],
  winPercentSeries: number[] = pairs.length ? [pairs[0].before, ...pairs.map(({ after }) => after)] : [],
  moveIndices: number[] = pairs.map((_, index) => index)
): number {
  if (pairs.length === 0) return 100;
  const accuracies = pairs.map(({ before, after }) => moveAccuracy(before, after));
  const moveCount = Math.max(1, winPercentSeries.length - 1);
  const requestedWindow = Math.max(2, Math.min(8, Math.floor(moveCount / 10)));
  const windowSize = Math.min(requestedWindow, winPercentSeries.length);
  if (windowSize < 2) return accuracies.reduce((sum, accuracy) => sum + accuracy, 0) / accuracies.length;

  const prefixSum = new Array(winPercentSeries.length + 1).fill(0);
  const prefixSquares = new Array(winPercentSeries.length + 1).fill(0);
  for (let i = 0; i < winPercentSeries.length; i++) {
    prefixSum[i + 1] = prefixSum[i] + winPercentSeries[i];
    prefixSquares[i + 1] = prefixSquares[i] + winPercentSeries[i] ** 2;
  }

  const repeatedInitialWindows = Math.max(0, Math.min(windowSize - 2, winPercentSeries.length - windowSize));
  const windows: number[] = [];
  for (let i = 0; i < repeatedInitialWindows; i++) windows.push(0);
  for (let start = 0; start + windowSize <= winPercentSeries.length; start++) windows.push(start);
  const weights = windows.map((start) => Math.max(0.5, Math.min(12,
    windowStdev(prefixSum, prefixSquares, start, windowSize))));

  let weightedTotal = 0;
  let totalWeight = 0;
  let reciprocalTotal = 0;
  for (let i = 0; i < accuracies.length; i++) {
    const index = Math.max(0, Math.min(moveCount - 1, Math.floor(moveIndices[i] ?? i)));
    const weight = weights[index] ?? 0.5;
    weightedTotal += accuracies[i] * weight;
    totalWeight += weight;
    reciprocalTotal += 1 / Math.max(0.001, accuracies[i]);
  }
  const weightedMean = weightedTotal / totalWeight;
  const harmonicMean = accuracies.length / reciprocalTotal;
  return Math.max(0, Math.min(100, (weightedMean + harmonicMean) / 2));
}

export interface PhaseSpan {
  name: 'opening' | 'middlegame' | 'endgame';
  fromPly: number;
  toPly: number;
}

/** Split phases by piece count. */
export function phaseSpans(pieceCounts: number[]): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let start = 0;
  let name: PhaseSpan['name'] | null = null;
  for (let ply = 0; ply < pieceCounts.length; ply++) {
    const count = pieceCounts[ply];
    const phase: PhaseSpan['name'] = count > 28 ? 'opening' : count <= 12 ? 'endgame' : 'middlegame';
    if (name !== null && phase !== name) spans.push({ name, fromPly: start, toPly: ply });
    if (phase !== name) {
      name = phase;
      start = ply;
    }
  }
  if (name !== null && start < pieceCounts.length) spans.push({ name, fromPly: start, toPly: pieceCounts.length });
  return spans;
}

export const CLS_ORDER: MoveCls[] = ['book', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'];
export const CLS_COLORS: Record<MoveCls, string> = {
  book: '#7d745e',
  best: '#81b64c',
  good: '#95a5a6',
  inaccuracy: '#f2b134',
  mistake: '#e8843c',
  blunder: '#d64545',
};
