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

/** State for the seek control: the slider bounds and cursor plus the text that
 * names the position under the cursor. Pure, so the clamps and wording are
 * unit-tested instead of buried in the screen. */
export interface SeekState {
  /** Highest selectable ply (0 when the line has no moves). */
  max: number;
  /** Cursor ply, clamped into 0..max. */
  value: number;
  /** Compact label next to the slider, e.g. "0/12" or "6/12". */
  label: string;
  /** Long description for screen readers, e.g. "Move 3...Nf6, ply 6 of 12". */
  valueText: string;
}

export function seekState(moves: readonly { san: string }[], index: number): SeekState {
  const max = moves.length;
  const value = Math.max(0, Math.min(max, Math.round(index)));
  if (value === 0) {
    return {
      max,
      value,
      label: `0/${max}`,
      valueText: max === 0 ? 'Starting position, no moves yet' : 'Starting position',
    };
  }
  const move = moves[value - 1];
  const number = Math.floor((value - 1) / 2) + 1;
  const dots = value % 2 === 1 ? '.' : '...';
  return {
    max,
    value,
    label: `${value}/${max}`,
    valueText: `Move ${number}${dots}${move.san}, ply ${value} of ${max}`,
  };
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
