/** Chess clock: base + increment, ticking only the side to move. */

import type { Color, TimeControl } from './types';

/**
 * Tracks remaining time per side. `now` is injectable so tests and UI ticks
 * share one code path. All times are milliseconds.
 */
export class ChessClock {
  private readonly baseMs: number;
  private readonly incMs: number;
  private readonly nowFn: () => number;
  private remaining: Record<Color, number>;
  private turn: Color;
  private stamp: number | null = null;

  constructor(
    tc: TimeControl,
    firstTurn: Color,
    now: () => number = () => performance.now(),
    /** Restore mid-game: remaining ms per side; defaults to the full base. */
    initial?: { w: number; b: number }
  ) {
    this.baseMs = Math.max(0, tc.base) * 1000;
    this.incMs = Math.max(0, tc.inc) * 1000;
    this.nowFn = now;
    this.remaining = {
      w: Math.max(0, Math.min(this.baseMs, initial?.w ?? this.baseMs)),
      b: Math.max(0, Math.min(this.baseMs, initial?.b ?? this.baseMs)),
    };
    this.turn = firstTurn;
    if (this.baseMs > 0) this.stamp = this.nowFn();
  }

  get timed(): boolean {
    return this.baseMs > 0;
  }

  remainingMs(color: Color): number {
    const base = this.remaining[color];
    if (!this.timed || color !== this.turn || this.stamp === null) return base;
    return Math.max(0, base - (this.nowFn() - this.stamp));
  }

  /** Move completed by the side to move: stop their clock, grant increment, flip. */
  movePlayed(): void {
    if (!this.timed) return;
    const now = this.nowFn();
    if (this.stamp !== null) {
      this.remaining[this.turn] = Math.max(0, this.remaining[this.turn] - (now - this.stamp));
      this.remaining[this.turn] += this.incMs;
    }
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.stamp = now;
  }

  /** True when the side to move has no time left. */
  flagged(): boolean {
    return this.timed && this.remainingMs(this.turn) <= 0;
  }

  /**
   * Freeze both clocks, banking the time the side to move has already spent.
   * Used while the player browses earlier positions: looking back at a game
   * must not cost them the game on time.
   */
  pause(): void {
    if (!this.timed || this.stamp === null) return;
    this.remaining[this.turn] = Math.max(0, this.remaining[this.turn] - (this.nowFn() - this.stamp));
    this.stamp = null;
  }

  /** Start the side to move ticking again after pause(). */
  resume(): void {
    if (!this.timed || this.stamp !== null) return;
    this.stamp = this.nowFn();
  }

  /** True while the clock is frozen (between pause() and resume()). */
  get paused(): boolean {
    return this.timed && this.stamp === null;
  }
}

/** m:ss display; tenths under 20s so flag races are readable. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, Math.ceil(ms / 100) / 10);
  const whole = Math.floor(clamped);
  const tenths = Math.round((clamped - whole) * 10);
  if (clamped < 20 && tenths > 0) return `${whole}.${tenths}`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
