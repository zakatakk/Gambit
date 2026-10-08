/**
 * Move-quality model for the analysis screen: how much evaluation a played
 * move concedes, judged from the engine's eval before and after it. Pure
 * logic (no DOM), so the thresholds and wording are unit-tested.
 *
 * All evals are White's point of view in centipawns, matching the eval bar.
 */

export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveJudgement {
  quality: MoveQuality;
  /** Eval conceded by the mover, in centipawns (0 when the move is best). */
  lossCp: number;
  /** White-POV eval before and after the move (mate folded into cp). */
  beforeCp: number;
  afterCp: number;
}

/** Mate scores fold into centipawns near ±10000 so losses stay comparable. */
export function toCp(cp: number | null, mate: number | null): number | null {
  if (mate !== null) return mate > 0 ? 10000 - mate * 100 : -10000 - mate * 100;
  if (cp === null) return null;
  return cp;
}

/** Loss bands in centipawns, roughly following common chess-site bands. */
const GOOD_MAX = 30;
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
}): MoveJudgement | null {
  const before = toCp(opts.beforeCp, opts.beforeMate);
  const after = toCp(opts.afterCp, opts.afterMate);
  if (before === null || after === null) return null;
  // White loses when the eval drops; Black loses when it rises.
  const swing = opts.mover === 'w' ? before - after : after - before;
  const lossCp = Math.max(0, swing);
  const playedBest =
    !!opts.playedUci && !!opts.bestUci && opts.playedUci === opts.bestUci;
  if (playedBest && lossCp <= GOOD_MAX) {
    return { quality: 'best', lossCp: 0, beforeCp: before, afterCp: after };
  }
  const quality: MoveQuality =
    lossCp <= GOOD_MAX
      ? 'good'
      : lossCp < INACCURACY_MAX
        ? 'inaccuracy'
        : lossCp <= MISTAKE_MAX
          ? 'mistake'
          : 'blunder';
  return { quality, lossCp, beforeCp: before, afterCp: after };
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
      return `Holds the evaluation about level (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}).`;
    case 'inaccuracy':
      return bestSan
        ? `A small slip (${pawns(j.beforeCp)} → ${pawns(j.afterCp)}). ${bestSan} was more precise.`
        : `A small slip: ${pawns(j.beforeCp)} → ${pawns(j.afterCp)}.`;
    case 'mistake':
      return bestSan
        ? `Gives up ${lossPhrase(j.lossCp)}. ${bestSan} was much better.`
        : `Gives up ${lossPhrase(j.lossCp)}.`;
    case 'blunder':
      return bestSan
        ? `A decisive error, surrendering ${lossPhrase(j.lossCp)}. ${bestSan} was the move.`
        : `A decisive error, surrendering ${lossPhrase(j.lossCp)}.`;
  }
}
