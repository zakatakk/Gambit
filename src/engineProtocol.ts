/**
 * Engine message protocol shared by the UI and worker code.
 * (Worker is created from a Blob so no separate worker entry is needed.)
 */

export type EngineRequest =
  | { type: 'init'; tier: 'lite' | 'full' }
  | { type: 'newgame' }
  | { type: 'play'; fen: string; strength: EngineStrengthParams }
  | { type: 'analyse'; fen: string; moveTime: number }
  | { type: 'stop' }
  | { type: 'quit' };

export interface EngineStrengthParams {
  skill: number;
  limitedElo: number | null;
  moveTime: number;
  /** Probability of deliberately choosing a worse line (human-like error). */
  blunderChance?: number;
  /** Centipawn window for randomizing among near-best lines. */
  randomCp?: number;
}

export type EngineResponse =
  | { type: 'status'; message: string }
  | { type: 'ready'; tier: string }
  | { type: 'bestmove'; from: string; to: string; promotion?: string; raw: string }
  | { type: 'eval'; cp: number | null; mate: number | null; pv: string[] }
  | { type: 'error'; message: string };

export interface ChessJsMove {
  from: string;
  to: string;
  promotion?: string;
}
