/** Captured-material summary derived from the current position vs the start set. */

import type { Chess } from 'chess.js';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const ORDER = ['q', 'r', 'b', 'n', 'p'] as const;

export interface CapturedSummary {
  /** Missing black pieces — what White captured, largest first. */
  byWhite: string[];
  /** Missing white pieces — what Black captured, largest first. */
  byBlack: string[];
  /** Positive when White is ahead on material (pawns=1, minor=3, rook=5, queen=9). */
  balance: number;
}

/** Promotion-aware: pieces "missing" beyond the start set are ignored. */
export function capturedSummary(game: Chess): CapturedSummary {
  const onBoard: Record<string, Record<string, number>> = { w: {}, b: {} };
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      onBoard[sq.color][sq.type] = (onBoard[sq.color][sq.type] ?? 0) + 1;
    }
  }
  const missing = (color: 'w' | 'b'): string[] => {
    const out: string[] = [];
    for (const type of ORDER) {
      const gone = Math.max(0, (START_COUNT[type] ?? 0) - (onBoard[color][type] ?? 0));
      for (let i = 0; i < gone; i++) out.push(type);
    }
    return out;
  };
  const byBlack = missing('w'); // missing white pieces = captured by Black
  const byWhite = missing('b');
  const value = (list: string[]) => list.reduce((sum, type) => sum + (PIECE_VALUE[type] ?? 0), 0);
  return { byWhite, byBlack, balance: value(byWhite) - value(byBlack) };
}
