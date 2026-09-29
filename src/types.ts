/** Shared app types. */

export type EngineTier = 'lite' | 'full';

export type GameType = 'cpu' | 'assessment' | 'passplay';
export type GameResult = 'win' | 'loss' | 'draw' | 'abandoned';
export type Color = 'w' | 'b';

/** Time control: increment seconds are added after each completed move. */
export interface TimeControl {
  /** Clock start in seconds (0 = untimed). */
  base: number;
  /** Increment per move in seconds. */
  inc: number;
}

export const TIME_CONTROLS: readonly { id: string; label: string; tc: TimeControl }[] = [
  { id: 'unlimited', label: 'No clock', tc: { base: 0, inc: 0 } },
  { id: 'bullet', label: '3+0 · bullet', tc: { base: 180, inc: 0 } },
  { id: 'blitz', label: '5+3 · blitz', tc: { base: 300, inc: 3 } },
  { id: 'rapid', label: '10+0 · rapid', tc: { base: 600, inc: 0 } },
  { id: 'classic', label: '15+10 · classical', tc: { base: 900, inc: 10 } },
];

/** Shared untimed control (default for CPU games and ladder play). */
export const UNTIMED: TimeControl = { base: 0, inc: 0 };

export interface Profile {
  rating: number;
  rd: number;
  volatility: number;
  lastPlayed: number;
  assessed: boolean;
}

export interface RatingHistoryPoint {
  ts: number;
  rating: number;
  rd: number;
  kind: 'assessment' | 'game' | 'puzzle' | 'reset' | 'seed';
}

export interface GameRecord {
  id?: number;
  ts: number;
  type: GameType;
  color: Color;
  result: GameResult;
  movesUci: string;
  startFen: string;
  opponentRating: number;
  opponentTier: EngineTier;
  rated: boolean;
  ratingBefore?: number;
  ratingAfter?: number;
  termination: string;
}

export interface PuzzleAttempt {
  id: string;
  won: boolean;
  rating: number;
  ts: number;
  score?: number;
  mistakes?: number;
}

export interface PuzzleItem {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  rd: number;
  popularity: number;
  themes: string[];
}

export type PieceSet = 'cburnett' | 'staunty' | 'merida';
export type BoardTheme = 'walnut' | 'marine' | 'slate';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  sounds: boolean;
  strictMode: boolean;
  engineTier: EngineTier;
  lastOpponentRating?: number;
  pieceSet: PieceSet;
  boardTheme: BoardTheme;
  autoQueen: boolean;
  showCoords: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sounds: true,
  strictMode: false,
  engineTier: 'lite',
  pieceSet: 'cburnett',
  boardTheme: 'walnut',
  autoQueen: true,
  showCoords: true,
};
