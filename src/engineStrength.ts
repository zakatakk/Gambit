/**
 * Maps a desired opponent rating (Lichess scale) to Stockfish parameters.
 * Calibrated to Lichess community-verified anchors: level 1 ≈ 800, 2 ≈ 1000,
 * 3 ≈ 1200, 4 ≈ 1400, 5 ≈ 1500, 6 ≈ 1900, 7 ≈ 2300, 8 ≈ 2800+.
 * Implemented as: skill 0-20 with UCI_LimitStrength + Elo slider (1500-2850)
 * for the top band, plus move-randomization so low ratings feel human.
 */

export interface EngineStrength {
  /** UCI Skill Level 0-20 */
  skill: number;
  /** UCI_LimitStrength true + Elo slider 1350-2850 (null = off) */
  limitedElo: number | null;
  /** Probability the engine picks a sub-optimal move (0-0.6) */
  blunderChance: number;
  /** Multi centipawn window for randomizing among near-best moves */
  randomCp: number;
  /** Think budget (ms) for the engine per move */
  moveTime: number;
}

export function ratingToStrength(targetRating: number, tier: 'lite' | 'full'): EngineStrength {
  const r = Math.max(600, Math.min(targetRating, 2900));
  const cap = tier === 'lite' ? 2350 : 2900;
  const clamped = Math.min(r, cap);

  // Below ~1500: low skill + heavy randomization (human-feeling weaker play).
  // 1500-2000: skill ramps 3->9, randomization tapers.
  // 2000-2350: skill 9->15, Elo limit 2000->2350.
  // 2350+: full strength, Elo limit up to 2850 (full tier only).
  let skill: number;
  let limitedElo: number | null = null;
  let blunderChance: number;
  let randomCp: number;

  if (clamped < 1500) {
    skill = Math.max(0, Math.round((clamped - 700) / 400)); // 0..2
    blunderChance = 0.55 - ((clamped - 700) / 800) * 0.25; // .55 -> .30
    randomCp = Math.round(140 - ((clamped - 700) / 800) * 60); // 140 -> 80
  } else if (clamped < 2000) {
    skill = Math.round(3 + ((clamped - 1500) / 500) * 6); // 3..9
    blunderChance = 0.25 - ((clamped - 1500) / 500) * 0.20; // .25 -> .05
    randomCp = Math.round(70 - ((clamped - 1500) / 500) * 30); // 70 -> 40
  } else if (clamped < 2350) {
    skill = Math.round(9 + ((clamped - 2000) / 350) * 6); // 9..15
    blunderChance = 0.05 - ((clamped - 2000) / 350) * 0.03;
    randomCp = Math.round(35 - ((clamped - 2000) / 350) * 20);
    limitedElo = Math.round(2000 + ((clamped - 2000) / 350) * 350);
  } else {
    skill = 16 + Math.round(((clamped - 2350) / 450) * 4); // 16..20 (2800 = full)
    blunderChance = 0;
    randomCp = 0;
    limitedElo = Math.round(2350 + ((clamped - 2350) / 450) * 500); // 2350..2850
  }

  return {
    skill: Math.max(0, Math.min(20, skill)),
    limitedElo: limitedElo ? Math.max(1350, Math.min(2850, limitedElo)) : null,
    blunderChance: Math.max(0, Math.min(0.6, blunderChance)),
    randomCp: Math.max(0, randomCp),
    // Higher-rated opponents think a bit longer, but keep it phone-friendly.
    moveTime: clamped < 2000 ? 700 : 900,
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
