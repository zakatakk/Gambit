/** Chess pieces and board appearance: official Lichess SVG sets + board color themes. */

import type { BoardTheme, PieceSet } from './types';

export const PIECE_SETS: readonly PieceSet[] = ['cburnett', 'staunty', 'merida'];
export const BOARD_THEMES: readonly BoardTheme[] = ['walnut', 'marine', 'slate'];

let currentPieceSet: PieceSet = 'cburnett';
let currentBoardTheme: BoardTheme = 'walnut';

/** Accepts legacy/stored values that predate a set's removal; falls back to cburnett. */
export function normalizePieceSet(value: unknown): PieceSet {
  return (PIECE_SETS as readonly string[]).includes(String(value)) ? (value as PieceSet) : 'cburnett';
}

export function normalizeBoardTheme(value: unknown): BoardTheme {
  return (BOARD_THEMES as readonly string[]).includes(String(value)) ? (value as BoardTheme) : 'walnut';
}

/** Directory name under public/pieces/ for each registered set. */
function setDir(set: PieceSet): string {
  return set; // folder names match the PieceSet ids: cburnett/, staunty/, merida/
}

export function pieceImgSrc(type: string, color: 'w' | 'b'): string {
  const t = type.toUpperCase(); // K Q R B N P
  const base = import.meta.env.BASE_URL || '/';
  return `${base}pieces/${setDir(currentPieceSet)}/${color}${t}.svg`;
}

export function pieceImg(type: string, color: 'w' | 'b'): HTMLImageElement {
  const img = document.createElement('img');
  img.src = pieceImgSrc(type, color);
  img.alt = '';
  img.draggable = false;
  return img;
}

export function applyPieceSet(set: PieceSet): void {
  currentPieceSet = normalizePieceSet(set);
}

export function applyBoardTheme(theme: BoardTheme): void {
  currentBoardTheme = normalizeBoardTheme(theme);
  document.documentElement.dataset.board = currentBoardTheme;
}

export function currentBoard(): BoardTheme {
  return currentBoardTheme;
}
