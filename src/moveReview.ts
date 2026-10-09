/**
 * Move-quality model for the analysis screen: how much evaluation a played
 * move concedes, judged from the engine's eval before and after it. Pure
 * logic (no DOM), so the thresholds and wording are unit-tested.
 *
 * All evals are White's point of view in centipawns, matching the eval bar.
 */

export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** One of the engine's own top lines for a position, all from the same search. */
export interface ParentLine {
  /** First move of the line, UCI (e.g. "g8f6"). */
  uci: string;
  /** Line eval in White's point of view. */
  cp: number | null;
  mate: number | null;
}

export interface MoveJudgement {
  quality: MoveQuality;
  /** Eval conceded by the mover, in centipawns (0 when the move is best). */
  lossCp: number;
  /** White-POV evals the verdict rests on. With `basis: 'lines'` these are the
   * engine's best line and the line containing the played move, both from one
   * search; with `basis: 'search'` they are the position evals before and after
   * the move, taken from two separate searches. */
  beforeCp: number;
  afterCp: number;
  /** `lines`: loss measured inside a single search, so the two numbers are
   * directly comparable. `search`: measured by comparing two independent
   * searches, which this engine disagrees with itself on by a pawn or more, so
   * only a clear loss is faulted. */
  basis: 'lines' | 'search';
}

/**
 * A loss this large is worth reporting even when it comes from comparing two
 * separate searches. Below it, a gap between searches says more about the
 * engine's inconsistency than about the move.
 */
export const CLEAR_LOSS_CP = 250;

/** Mate scores fold into centipawns near ±10000 so losses stay comparable. */
export function toCp(cp: number | null, mate: number | null): number | null {
  if (mate !== null) return mate > 0 ? 10000 - mate * 100 : -10000 - mate * 100;
  if (cp === null) return null;
  return cp;
}

/**
 * Loss bands in centipawns, roughly following common chess-site bands.
 *
 * `good` is deliberately wide: this engine's shipped "lite" build ranks moves
 * that are practically equal (the whole of its own top three in a quiet
 * opening position) within ~25-45cp of each other, and it reorders them between
 * searches. Faulting a move for a gap that size reads as noise to the player.
 */
const GOOD_MAX = 50;
const INACCURACY_MAX = 100;
const MISTAKE_MAX = 250;

export function judgeMove(opts: {
  playedUci: string | null;
  bestUci: string | null;
  beforeCp: number | null;
  beforeMate: number | null;
  afterCp: number | null;
  afterMate: number | null;
  mover: 'w' | 'b';
  /** The engine's own top lines for the position before the move. */
  lines?: ParentLine[];
  /** Cross-search losses below this are not faulted (see CLEAR_LOSS_CP). */
  noiseFloorCp?: number;
}): MoveJudgement | null {
  const before = toCp(opts.beforeCp, opts.beforeMate);
  const after = toCp(opts.afterCp, opts.afterMate);
  if (before === null || after === null) return null;
  // White loses when the eval drops; Black loses when it rises.
  const conceded = (best: number, played: number) =>
    Math.max(0, opts.mover === 'w' ? best - played : played - best);

  // Prefer the engine's own top lines: the played move's rank and eval there
  // come from the same search as the best line, so they are comparable. This is
  // the whole point — the engine's opinion of two *separate* positions can be
  // off by a pawn, which used to fault perfectly good moves.
  const lines = opts.lines ?? [];
  const rank = opts.playedUci ? lines.findIndex((line) => line.uci === opts.playedUci) : -1;
  const lineTop = rank >= 0 ? toCp(lines[0].cp, lines[0].mate) : null;
  const linePlayed = rank > 0 ? toCp(lines[rank].cp, lines[rank].mate) : null;

  // The engine's own top choice can never be a fault: the eval before the move
  // is the eval of the best line, so replaying that move concedes nothing by
  // definition. (Grading it by the bands is what used to print "Mistake — h6 was
  // much better" for the very move the engine had recommended.)
  const playedBest =
    !!opts.playedUci && !!opts.bestUci && opts.playedUci === opts.bestUci;
  if (rank === 0 || playedBest) {
    return {
      quality: 'best',
      lossCp: 0,
      beforeCp: before,
      afterCp: after,
      basis: rank === 0 ? 'lines' : 'search',
    };
  }

  const fromLines = rank > 0 && lineTop !== null && linePlayed !== null;
  const lossCp = fromLines ? conceded(lineTop, linePlayed) : conceded(before, after);
  const floor = opts.noiseFloorCp ?? 0;
  if (!fromLines && lossCp < floor) {
    // Cross-search evidence only: below the floor the gap is the engine
    // disagreeing with itself, not the move.
    return { quality: 'good', lossCp, beforeCp: before, afterCp: after, basis: 'search' };
  }
  const quality: MoveQuality =
    lossCp <= GOOD_MAX
      ? 'good'
      : lossCp < INACCURACY_MAX
        ? 'inaccuracy'
        : lossCp <= MISTAKE_MAX
          ? 'mistake'
          : 'blunder';
  return {
    quality,
    lossCp,
    beforeCp: fromLines ? (lineTop as number) : before,
    afterCp: fromLines ? (linePlayed as number) : after,
    basis: fromLines ? 'lines' : 'search',
  };
}

export const QUALITY_GLYPHS: Record<MoveQuality, string> = {
  best: '★',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

export const QUALITY_LABELS: Record<MoveQuality, string> = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

function pawns(cp: number): string {
  const p = cp / 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}`;
}

/** "about 1.5 pawns", or a mate-safe phrase for total collapses. */
function lossPhrase(lossCp: number): string {
  if (lossCp >= 1000) return 'the whole advantage';
  return `about ${(lossCp / 100).toFixed(1)} pawns`;
}

/** One sentence for the review panel. `bestSan` is the engine's better move,
 * or null when it is unknown. Evals in the text are White's point of view. */
export function explainMove(j: MoveJudgement, bestSan: string | null): string {
  switch (j.quality) {
    case 'best':
      return "The engine's top choice — nothing better was available.";
    case 'good':
      // Cross-search evals are too rough to quote as if the drop were real.
      return j.basis === 'lines'
        ? `Close to the engine's top choice (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}).`
        : "Close to the engine's top choice — nothing significant given up.";
    case 'inaccuracy':
      return bestSan
        ? `A small slip (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}). ${bestSan} was more precise.`
        : `A small slip: ${pawns(j.beforeCp)} → ${pawns(j.afterCp)}.`;
    case 'mistake':
      return bestSan
        ? `Gives up ${lossPhrase(j.lossCp)} (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}). ${bestSan} was much better.`
        : `Gives up ${lossPhrase(j.lossCp)} (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}).`;
    case 'blunder':
      return bestSan
        ? `A decisive error, surrendering ${lossPhrase(j.lossCp)} (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}). ${bestSan} was the move.`
        : `A decisive error, surrendering ${lossPhrase(j.lossCp)} (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}).`;
  }
}
