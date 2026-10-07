/** Types shared with the engine worker adapter. */

export interface EngineStrengthParams {
  skill: number;
  limitedElo: number | null;
  moveTime: number;
  /** Probability of deliberately choosing a worse line (human-like error). */
  blunderChance?: number;
  /** Centipawn window for randomizing among near-best lines. */
  randomCp?: number;
  /** Max centipawn loss vs best for a candidate to enter the blunder pool (default 320). */
  blunderWindowCp?: number;
  /** Min centipawn score allowed for a blunder pick (default -400). */
  blunderFloorCp?: number;
  /** Root lines the engine evaluates (default 5 when randomizing, else 1). */
  multipv?: number;
  /** Hard search depth cap; when set the engine plays `go depth N` instead of on move time. */
  depth?: number | null;
}

export interface ChessJsMove {
  from: string;
  to: string;
  promotion?: string;
}
