/**
 * Review scoring: win-probability model + move classification + accuracy.
 * Win% model is the Lichess-style logistic: winPct(cp) = 50 + 50*(2/(1+e^(-0.00368208*cp))-1).
 * Raw centipawn loss misleads in decided positions (±3 pawns up barely matters);
 * win% drop scales severity with the real stakes, which is what teaches.
 */

export type MoveCls = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** White's expected score (0-100) from a white-POV centipawn eval. */
export function winPct(cpWhitePov: number): number {
  const v = 2 / (1 + Math.exp(-0.00368208 * cpWhitePov)) - 1;
  return 50 + 50 * v;
}

/** Win% from mate distance; sign from mover's POV converted to white POV via isWhite. */
export function mateWinPct(mate: number, whitePov: boolean): number {
  const inN = Math.abs(mate);
  // Mate in 1 ≈ 99.5, tapering to ~85 at mate in 15+.
  const pct = Math.max(85, 99.5 - (inN - 1) * 1.0);
  return (mate > 0) === whitePov ? pct : 100 - pct;
}

export interface MoveEval {
  /** white-POV eval before the move (cp or mate) */
  before: { cp: number | null; mate: number | null };
  /** white-POV eval after the move (opponent to move) */
  after: { cp: number | null; mate: number | null };
  /** best line's eval before the move (white POV) */
  best: { cp: number | null; mate: number | null };
}

function toWinPct(e: { cp: number | null; mate: number | null }, whitePov: boolean): number {
  if (e.mate !== null) return mateWinPct(e.mate, whitePov);
  return winPct(e.cp ?? 0);
}

/** Win% the mover gave up vs best play, 0-100 (mover POV). */
export function winDrop(m: MoveEval, moverIsWhite: boolean): number {
  const beforeBest = toWinPct(m.best, true);
  const after = toWinPct(m.after, true);
  const before = moverIsWhite ? beforeBest : 100 - beforeBest;
  const afterPov = moverIsWhite ? after : 100 - after;
  return Math.max(0, before - afterPov);
}

export interface ClassifyThresholds {
  inaccuracy: number; // win% drop
  mistake: number;
  blunder: number;
}

export const DEFAULT_THRESHOLDS: ClassifyThresholds = {
  inaccuracy: 6,
  mistake: 12,
  blunder: 20,
};

/** Only-the-best-move gets 'best'; everything else graded by win% drop. */
export function classify(drop: number, playedIsBest: boolean, t: ClassifyThresholds = DEFAULT_THRESHOLDS): MoveCls {
  if (playedIsBest || drop < 2) return 'best';
  if (drop >= t.blunder) return 'blunder';
  if (drop >= t.mistake) return 'mistake';
  if (drop >= t.inaccuracy) return 'inaccuracy';
  return 'good';
}

/** Lichess-style per-move accuracy from win% before/after (mover POV, 0-100). */
export function moveAccuracy(beforePov: number, afterPov: number): number {
  // Harmonic-style curve: harsh on drops, near-100 on tiny ones.
  const diff = Math.max(0, beforePov - afterPov);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * diff) - 3.1669));
}

/** Aggregate accuracy across a game from per-move win% pairs (Lichess formula). */
export function aggregateAccuracy(pairs: { before: number; after: number }[]): number {
  if (pairs.length === 0) return 100;
  const mean = pairs.reduce((s, p) => s + moveAccuracy(p.before, p.after), 0) / pairs.length;
  // Lichess applies a second curve on the mean per-move accuracy.
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * mean) - 3.1669) > 100
    ? 100
    : 100 - (100 - mean) * 1.0);
}

export interface PhaseSpan {
  name: 'opening' | 'middlegame' | 'endgame';
  fromPly: number;
  toPly: number; // exclusive
}

/** Phase split by piece count: opening while > 30 pieces on board, endgame when <= 12. */
export function phaseSpans(pieceCounts: number[]): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let cur: PhaseSpan = { name: 'opening', fromPly: 0, toPly: 0 };
  let curName: PhaseSpan['name'] = 'opening';
  for (let ply = 0; ply < pieceCounts.length; ply++) {
    const n = pieceCounts[ply];
    let name: PhaseSpan['name'] = 'middlegame';
    if (n > 28) name = 'opening';
    else if (n <= 12) name = 'endgame';
    if (name !== curName) {
      cur.toPly = ply;
      spans.push(cur);
      cur = { name, fromPly: ply, toPly: ply };
      curName = name;
    } else {
      cur.toPly = ply + 1;
    }
  }
  cur.toPly = pieceCounts.length;
  spans.push(cur);
  return spans.filter((s) => s.toPly > s.fromPly);
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
