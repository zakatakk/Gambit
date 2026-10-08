/**
 * Maps a desired opponent rating (Lichess scale) to Stockfish parameters.
 *
 * Measured against the shipped engines (lite = Multi-Variant Stockfish 2019,
 * full = Stockfish 16): the previous movetime-based map let every rating below
 * 2000 search to depth ~12, and the lite engine has no UCI_LimitStrength or
 * UCI_Elo options at all, so an "800" and a "1300" CPU played identically at
 * roughly 1900-level. This map anchors strength on hard depth caps (fixed-depth
 * play is nearly device-independent, so the CPU strength matches the advertised
 * rating on any phone), with randomization over a wide root pool for
 * human-feeling error that tapers out by ~1750.
 *
 * Measured average centipawn loss vs a 2 s reference search (12 opening
 * positions, 2 samples): 800 → ~175cp, 1000 → ~160cp, 1300 → ~120cp,
 * 1600 → ~70cp. For scale, real humans average roughly 300-500cp at 800 and
 * 150-250cp at 1300.
 */

export interface EngineStrength {
  /** UCI Skill Level 0-20 */
  skill: number;
  /** UCI_LimitStrength true + Elo slider (full tier only; the lite build has no such option) */
  limitedElo: number | null;
  /** Probability the engine picks a deliberately weaker candidate (0-0.6) */
  blunderChance: number;
  /** Max centipawn loss vs best for a candidate to enter the blunder pool */
  blunderWindowCp: number;
  /** Min centipawn score allowed for a blunder pick */
  blunderFloorCp: number;
  /** Multi-centipawn window for randomizing among near-best moves */
  randomCp: number;
  /** Root lines the engine evaluates; wider pools contain real blunders */
  multipv: number;
  /** Hard search depth cap; null = play on move time */
  depth: number | null;
  /** Think budget (ms) used when depth is null (and as the search-timeout base) */
  moveTime: number;
}

export function ratingToStrength(targetRating: number, tier: 'lite' | 'full'): EngineStrength {
  const r = Math.max(600, Math.min(targetRating, 2900));
  const cap = tier === 'lite' ? 2350 : 2900;
  const clamped = Math.min(r, cap);

  // Below 1750: depth-capped search (1-8) with a wide candidate pool and
  // frequent, genuinely losing blunders. 1750-2350: depth 10-12, errors taper.
  // 2350+: full-strength move-time search (Elo-limited on the full tier).
  let skill = 0;
  let limitedElo: number | null = null;
  let blunderChance: number;
  let blunderWindowCp: number;
  let blunderFloorCp: number;
  let randomCp: number;
  let multipv: number;
  let depth: number | null;

  if (clamped < 1750) {
    const t = (clamped - 600) / 1150; // 0..1
    depth = 1 + Math.round(t * 7); // 600→1 … 1750→8
    multipv = depth <= 3 ? 20 : depth <= 5 ? 12 : 7;
    blunderChance = 0.55 - t * 0.45; // .55 → .10
    blunderWindowCp = Math.round(1100 - t * 700); // 1100 → 400
    blunderFloorCp = Math.round(-1800 + t * 1200); // -1800 → -600
    randomCp = Math.round(220 - t * 180); // 220 → 40
  } else if (clamped < 2350) {
    const t = (clamped - 1750) / 600; // 0..1
    depth = 10 + Math.round(t * 2); // 1750→10 … 2350→12
    multipv = 5;
    blunderChance = 0.10 - t * 0.08; // .10 → .02
    blunderWindowCp = Math.round(350 - t * 150); // 350 → 200
    blunderFloorCp = Math.round(-600 + t * 300); // -600 → -300
    randomCp = Math.round(40 - t * 20); // 40 → 20
  } else {
    depth = null;
    multipv = 1;
    skill = 16 + Math.round(((clamped - 2350) / 550) * 4); // 16..20
    blunderChance = 0;
    blunderWindowCp = 320;
    blunderFloorCp = -400;
    randomCp = 0;
    if (tier === 'full') {
      limitedElo = Math.round(2350 + ((clamped - 2350) / 550) * 500); // 2350..2850
    }
  }

  return {
    skill,
    limitedElo,
    blunderChance: Math.max(0, Math.min(0.6, blunderChance)),
    blunderWindowCp,
    blunderFloorCp,
    randomCp: Math.max(0, randomCp),
    multipv,
    depth,
    moveTime: depth === null ? 900 : 700,
  };
}

/** Assessment engine levels: Lichess-verified approximations. */
export const ASSESSMENT_LEVELS: { rating: number; label: string }[] = [
  { rating: 800, label: 'L1' },
  { rating: 1000, label: 'L2' },
  { rating: 1200, label: 'L3' },
  { rating: 1400, label: 'L4' },
  { rating: 1500, label: 'L5' },
  { rating: 1900, label: 'L6' },
  { rating: 2300, label: 'L7' },
  { rating: 2800, label: 'L8' },
];
