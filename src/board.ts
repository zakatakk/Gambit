/** Chess board UI: tap-tap + drag input, legal-move dots, promotion picker. */
import { Chess, type Square } from 'chess.js';
import { pieceImg } from './pieces';
import type { Color } from './types';

export interface BoardOptions {
  orientation: Color;
  interactive: boolean;
  /** Skip the promotion picker and always promote to a queen (Settings). */
  autoQueen?: boolean;
  /** Show file/rank coordinates on the board edges (Settings). */
  showCoords?: boolean;
  /** Position-editor hook: free placement, any-piece drags, removals. */
  onEdit?: (action: { type: 'tap' | 'move' | 'remove' | 'clear'; from?: string; to?: string }) => void;
  onMove: (m: { from: string; to: string; promotion?: string }) => void;
}

/** The selected editor tool, resolved per interaction by the owning screen. */
export type EditBrush = { color: Color; type: string } | 'trash' | null;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

/** A quick tap: released on the same square, barely moved, short press. */
const TAP_MS = 280;
const TAP_SLOP_PX = 9;

export function boardSquareAt(row: number, col: number, orientation: Color): string {
  const white = orientation === 'w';
  return `${FILES[white ? col : 7 - col]}${RANKS[white ? row : 7 - row]}`;
}

export class Board {
  el: HTMLElement;
  private game: Chess;
  private opts: BoardOptions;
  private selected: Square | null = null;
  private pendingPromotion: { from: Square; to: string } | null = null;
  private dragging: { from: Square; ghost: HTMLElement } | null = null;
  private dragStart: { x: number; y: number; t: number } | null = null;
  private lastMove: { from: string; to: string } | null = null;
  private previewFen: string | null = null;
  private previewLastMove: { from: string; to: string } | null = null;
  private editMode = false;
  private brush: (() => EditBrush) | null = null;
  private squareEls = new Map<string, HTMLElement>();

  constructor(container: HTMLElement, game: Chess, opts: BoardOptions) {
    this.game = game;
    this.opts = opts;
    this.el = document.createElement('div');
    this.el.className = 'board';
    container.appendChild(this.el);
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.editMode && this.opts.onEdit) {
        const sq = this.sqFromPoint(e.clientX, e.clientY);
        if (sq) this.opts.onEdit({ type: this.brush?.() === 'trash' ? 'clear' : 'remove', from: sq });
      }
    });
    // Capture retargets pointerup here — resolve from coordinates, not event target.
    this.el.addEventListener('pointerup', (e) => this.onBoardPointerUp(e));
    this.buildGrid();
    this.render();
  }

  setOrientation(o: Color): void {
    this.opts.orientation = o;
    this.buildGrid();
    this.render();
  }

  get orientation(): Color {
    return this.opts.orientation;
  }

  /** Edit mode: drags move any piece anywhere; taps and drops report to onEdit. */
  setEditMode(on: boolean): void {
    this.editMode = on;
    this.selected = null;
    this.clearMarks();
  }

  /** The screen answers "what tool is armed right now?" for tap placement. */
  setBrushResolver(resolve: () => EditBrush): void {
    this.brush = resolve;
  }

  setLastMove(m: { from: string; to: string } | null): void {
    this.lastMove = m;
  }

  setInteractive(v: boolean): void {
    this.opts.interactive = v;
    if (!v) this.clearMarks();
  }

  deselect(): void {
    this.selected = null;
    this.clearMarks();
  }

  /** Show a past position without touching the live game state. */
  showPosition(fen: string, lastMove: { from: string; to: string } | null): void {
    this.previewFen = fen;
    this.previewLastMove = lastMove;
    this.selected = null;
    this.pendingPromotion = null;
    this.el.parentElement?.querySelectorAll('.promo').forEach((n) => n.remove());
    this.render();
  }

  /** Return the board to the live game position. */
  clearPreview(): void {
    if (this.previewFen === null) return;
    this.previewFen = null;
    this.previewLastMove = null;
    this.render();
  }

  private buildGrid(): void {
    this.el.innerHTML = '';
    this.squareEls.clear();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        // White: a8 top-left. Black: proper 180° rotation — h1 top-left.
        const sq = boardSquareAt(r, f, this.opts.orientation);
        const cell = document.createElement('div');
        cell.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
        cell.dataset.sq = sq;
        if (this.opts.showCoords !== false && r === 7) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord file';
          fileLabel.textContent = sq[0];
          cell.appendChild(fileLabel);
        }
        if (this.opts.showCoords !== false && f === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord rank';
          rankLabel.textContent = sq[1];
          cell.appendChild(rankLabel);
        }
        this.squareEls.set(sq, cell);
        this.el.appendChild(cell);
        cell.addEventListener('pointerdown', (e) => this.onPointerDown(e, sq));
        cell.addEventListener('pointermove', (e) => this.onPointerMove(e));
        cell.addEventListener('pointercancel', () => this.cancelDrag());
      }
    }
  }

  /** Re-render pieces + highlights from live or preview position. */
  render(): void {
    const previewGame = this.previewFen === null ? null : new Chess(this.previewFen);
    const lastMove = this.previewFen === null ? this.lastMove : this.previewLastMove;
    for (const [sq, cell] of this.squareEls) {
      cell.classList.remove('sel', 'last', 'dot', 'capturable', 'over');
      cell.querySelectorAll('.piece').forEach((n) => n.remove());
      const piece = previewGame ? previewGame.get(sq as Square) : this.game.get(sq as Square);
      if (piece) {
        const wrap = document.createElement('div');
        wrap.className = 'piece';
        wrap.appendChild(pieceImg(piece.type, piece.color));
        cell.appendChild(wrap);
      }
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
        cell.classList.add('last');
      }
    }
    if (!previewGame && this.selected) {
      this.squareEls.get(this.selected)?.classList.add('sel');
      this.showLegal(this.selected);
    }
  }

  private sqFromPoint(x: number, y: number): string | null {
    const rect = this.el.getBoundingClientRect();
    const size = rect.width;
    const col = Math.floor(((x - rect.left) / size) * 8);
    const row = Math.floor(((y - rect.top) / size) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return boardSquareAt(row, col, this.opts.orientation);
  }

  /** Board-level pointerup: handles drag drops (capture retargets here) and taps. */
  private onBoardPointerUp(e: PointerEvent): void {
    const sq = this.sqFromPoint(e.clientX, e.clientY);
    if (this.dragging) {
      const { from, ghost } = this.dragging;
      const start = this.dragStart;
      this.dragging = null;
      this.dragStart = null;
      ghost.remove();
      for (const [, cell] of this.squareEls) cell.classList.remove('over');
      this.releasePointer(e);
      if (this.editMode) {
        if (!sq) {
          // Dragged off the board — Lichess-style delete.
          this.opts.onEdit?.({ type: 'clear', from });
        } else if (sq !== from) {
          this.opts.onEdit?.({ type: 'move', from, to: sq });
        } else if (
          start !== null &&
          Date.now() - start.t < TAP_MS &&
          Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP_PX
        ) {
          // Quick tap on an occupied square: place/replace/toggle via the screen.
          if (this.brush?.() === 'trash') this.opts.onEdit?.({ type: 'remove', from });
          else this.opts.onEdit?.({ type: 'tap', to: sq });
        }
        return;
      }
      if (!sq || sq === from) return; // drop back on origin: keep selection (tap-tap)
      const moved = this.attemptMove(from, sq, true);
      if (moved && !this.pendingPromotion) {
        this.clearMarks();
        this.selected = null;
      }
      return;
    }
    // Tap-tap: a selected piece + release on a legal target square.
    if (this.selected && sq && sq !== this.selected) {
      const moved = this.attemptMove(this.selected, sq, false);
      this.clearMarks();
      this.selected = null;
      if (moved) this.releasePointer(e);
    }
  }

  private releasePointer(e: PointerEvent): void {
    try {
      if (this.el.hasPointerCapture?.(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private capturePointer(e: PointerEvent): void {
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic/inactive pointers (tests) have no active pointer — ignore.
    }
  }

  private onPointerDown(e: PointerEvent, sq: string): void {
    if (!this.opts.interactive || this.pendingPromotion || this.previewFen !== null) return;
    if (!e.isPrimary) return; // pinch/second finger must not hijack a drag
    if (this.editMode) {
      e.preventDefault();
      const piece = this.game.get(sq as Square);
      if (piece) {
        // Any piece can be picked up and dragged, brush or not.
        this.capturePointer(e);
        this.startDrag(e, sq as Square, piece);
        return;
      }
      const b = this.brush?.();
      if (b && b !== 'trash') {
        // Drag the armed piece out of the pocket, or tap to stamp it below.
        this.capturePointer(e);
        this.startDrag(e, sq as Square, b);
      }
      return;
    }
    // Capture the pointer on the BOARD (not the square) so drags keep firing
    // pointermove/pointerup at the board even if the finger leaves the cell.
    this.capturePointer(e);
    const piece = this.game.get(sq as Square);
    const myColor: Color = this.game.turn();
    if (piece && piece.color === myColor) {
      this.selected = sq as Square;
      this.clearMarks();
      this.squareEls.get(sq)?.classList.add('sel');
      this.showLegal(sq as Square);
      this.startDrag(e, sq as Square, piece);
      e.preventDefault();
    } else if (this.selected) {
      const moved = this.attemptMove(this.selected, sq, false);
      if (!moved) {
        this.clearMarks();
        this.selected = null;
      }
    }
  }

  private startDrag(e: PointerEvent, from: Square, piece: { type: string; color: Color }): void {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.appendChild(pieceImg(piece.type, piece.color));
    document.body.appendChild(ghost);
    this.dragging = { from, ghost };
    this.dragStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    this.moveGhost(e);
  }

  private moveGhost(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging.ghost.style.left = `${e.clientX}px`;
    this.dragging.ghost.style.top = `${e.clientY}px`;
    const sq = this.sqFromPoint(e.clientX, e.clientY);
    for (const [, cell] of this.squareEls) cell.classList.remove('over');
    if (sq) this.squareEls.get(sq)?.classList.add('over');
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragging) this.moveGhost(e);
  }

  private cancelDrag(): void {
    if (this.dragging) {
      this.dragging.ghost.remove();
      this.dragging = null;
      this.dragStart = null;
      for (const [, cell] of this.squareEls) cell.classList.remove('over');
    }
  }

  private showLegal(sq: Square): void {
    const moves = this.game.moves({ square: sq, verbose: true });
    for (const m of moves) {
      const cell = this.squareEls.get(m.to);
      if (!cell) continue;
      cell.classList.add(this.game.get(m.to as Square) ? 'capturable' : 'dot');
    }
  }

  private clearMarks(): void {
    for (const [, cell] of this.squareEls) cell.classList.remove('dot', 'capturable', 'sel');
  }

  private attemptMove(from: Square, to: string, viaDrag: boolean): boolean {
    const legal = this.game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (legal.length === 0) return false;
    if (legal.some((m) => m.promotion)) {
      if (this.opts.autoQueen) {
        this.pendingPromotion = null;
        this.clearMarks();
        this.selected = null;
        this.opts.onMove({ from, to, promotion: 'q' });
        return true;
      }
      this.pendingPromotion = { from, to };
      this.showPromoMenu(from, to);
      return true;
    }
    void viaDrag;
    this.clearMarks();
    this.selected = null;
    this.opts.onMove({ from, to });
    return true;
  }

  private showPromoMenu(from: Square, to: string): void {
    const white = this.game.turn() === 'w';
    const menu = document.createElement('div');
    menu.className = 'promo';
    for (const t of ['q', 'r', 'n', 'b'] as const) {
      const b = document.createElement('button');
      b.appendChild(pieceImg(t, white ? 'w' : 'b'));
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        menu.remove();
        this.pendingPromotion = null;
        this.opts.onMove({ from, to, promotion: t });
      });
      menu.appendChild(b);
    }
    this.el.parentElement?.appendChild(menu);
  }
}
