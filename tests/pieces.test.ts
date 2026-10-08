import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBoardTheme,
  applyPieceSet,
  BOARD_THEMES,
  normalizeBoardTheme,
  normalizePieceSet,
  PIECE_SETS,
  pieceImgSrc,
} from '../src/pieces';

describe('piece set registry', () => {
  it('ships 12 valid SVGs for every registered set', () => {
    for (const set of PIECE_SETS) {
      for (const color of ['w', 'b']) {
        for (const type of ['K', 'Q', 'R', 'B', 'N', 'P']) {
          const svg = readFileSync(new URL(`../public/pieces/${set}/${color}${type}.svg`, import.meta.url), 'utf8');
          expect(svg).toContain('<svg');
        }
      }
    }
  });

  it('builds image URLs from the active set', () => {
    applyPieceSet('staunty');
    expect(pieceImgSrc('q', 'w')).toBe('/pieces/staunty/wQ.svg');
    applyPieceSet('cburnett');
    expect(pieceImgSrc('n', 'b')).toBe('/pieces/cburnett/bN.svg');
  });

  it('falls back to cburnett for unknown sets', () => {
    expect(normalizePieceSet('merida')).toBe('merida');
    expect(normalizePieceSet('wooden')).toBe('cburnett');
    expect(normalizePieceSet(undefined)).toBe('cburnett');
    applyPieceSet('wooden' as never);
    expect(pieceImgSrc('p', 'w')).toBe('/pieces/cburnett/wP.svg');
  });
});

describe('board theme registry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies known themes to the document and rejects unknown ones', () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal('document', { documentElement: { dataset } });
    expect(BOARD_THEMES).toContain('walnut');
    applyBoardTheme('marine');
    expect(dataset.board).toBe('marine');
    applyBoardTheme('neon' as never);
    expect(dataset.board).toBe('walnut');
    expect(normalizeBoardTheme('slate')).toBe('slate');
    expect(normalizeBoardTheme(42)).toBe('walnut');
    applyBoardTheme('walnut');
    expect(dataset.board).toBe('walnut');
  });
});
