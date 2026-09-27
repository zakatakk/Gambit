/** Chess pieces: official cburnett SVGs from pieces/cburnett (Lichess set). */

export function pieceImgSrc(type: string, color: 'w' | 'b'): string {
  const t = type.toUpperCase(); // K Q R B N P
  const base = import.meta.env.BASE_URL || '/';
  return `${base}pieces/cburnett/${color}${t}.svg`;
}

export function pieceImg(type: string, color: 'w' | 'b'): HTMLImageElement {
  const img = document.createElement('img');
  img.src = pieceImgSrc(type, color);
  img.alt = '';
  img.draggable = false;
  return img;
}

/** Kept for compatibility with existing callers (returns an <img>). */
export function pieceSvg(type: string, color: 'w' | 'b'): HTMLImageElement {
  return pieceImg(type, color);
}
