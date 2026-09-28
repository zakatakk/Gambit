/** Types shared with the engine worker adapter. */

export interface EngineStrengthParams {
  skill: number;
  limitedElo: number | null;
  moveTime: number;
  /** Probability of deliberately choosing a worse line (human-like error). */
  blunderChance?: number;
  /** Centipawn window for randomizing among near-best lines. */
  randomCp?: number;
}

export interface ChessJsMove {
  from: string;
  to: string;
  promotion?: string;
}
