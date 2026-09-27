/** Shared app types. */

export type EngineTier = 'lite' | 'full';

export type GameType = 'cpu' | 'assessment';
export type GameResult = 'win' | 'loss' | 'draw' | 'abandoned';
export type Color = 'w' | 'b';

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

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  sounds: boolean;
  strictMode: boolean;
  engineTier: EngineTier;
  lastOpponentRating?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sounds: true,
  strictMode: false,
  engineTier: 'lite',
};
