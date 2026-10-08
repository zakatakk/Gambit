/**
 * Move line for the analysis board: a root position plus the moves played from
 * it, with a cursor that can point at any ply. Pure logic (no DOM), so the
 * navigation rules are unit-tested.
 */

export interface LineMove {
  san: string;
  /** Long algebraic move, e.g. "e2e4" or "e7e8q". */
  uci: string;
  /** FEN after this move. */
  fen: string;
}

export class AnalysisLine {
  private root: string;
  private moves: LineMove[] = [];
  private cursor = 0;

  constructor(rootFen: string) {
    this.root = rootFen;
  }

  get rootFen(): string {
    return this.root;
  }

  get list(): readonly LineMove[] {
    return this.moves;
  }

  /** Number of plies applied to the root (0 = the root position itself). */
  get index(): number {
    return this.cursor;
  }

  currentFen(): string {
    return this.cursor === 0 ? this.root : this.moves[this.cursor - 1].fen;
  }

  /** The move that produced the current position, for last-move highlighting. */
  lastMove(): { from: string; to: string } | null {
    if (this.cursor === 0) return null;
    const uci = this.moves[this.cursor - 1].uci;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  }

  /** Start a new line from a position (setup, pasted FEN, or an edit). */
  reset(fen: string): void {
    this.root = fen;
    this.moves = [];
    this.cursor = 0;
  }

  /** Append a move at the cursor. Playing from an earlier ply replaces the
   * moves after it, the same way a new branch replaces the old continuation. */
  push(move: LineMove): void {
    this.moves = [...this.moves.slice(0, this.cursor), move];
    this.cursor = this.moves.length;
  }

  /** Move the cursor, clamped to the line. Returns false when nothing changed. */
  goTo(index: number): boolean {
    const clamped = Math.max(0, Math.min(this.moves.length, index));
    if (clamped === this.cursor) return false;
    this.cursor = clamped;
    return true;
  }
}

/** Eval text from White's point of view: "+1.2", "-0.4", "0.0", "M3", "-M2". */
export function formatEval(whiteCp: number | null, whiteMate: number | null): string {
  if (whiteMate !== null) {
    return whiteMate > 0 ? `M${whiteMate}` : `-M${Math.abs(whiteMate)}`;
  }
  if (whiteCp === null) return '';
  const pawns = whiteCp / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

/** White's share of the eval bar, 0..1. Clamped at +-10 pawns, like the bar. */
export function evalFraction(whiteCp: number | null, whiteMate: number | null): number {
  if (whiteMate !== null) return whiteMate > 0 ? 1 : whiteMate < 0 ? 0 : 0.5;
  if (whiteCp === null) return 0.5;
  const clamped = Math.max(-1000, Math.min(1000, whiteCp));
  return 0.5 + clamped / 2000;
}
