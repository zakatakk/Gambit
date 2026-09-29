/**
 * Unfinished-game snapshots: enough to restore a game in progress after the
 * app was closed. Single slot, saved after every move, cleared when a game
 * finishes or is abandoned. Version field lets future formats migrate.
 */

import type { Color, EngineTier, GameType, TimeControl } from './types';

export interface SavedLiveGame {
  version: 1;
  type: Exclude<GameType, 'assessment'>;
  startFen: string;
  /** Space-joined UCI moves played so far. */
  movesUci: string;
  /** Human's color for CPU games; board orientation hint for pass-and-play. */
  playerColor: Color;
  oppRating: number;
  oppTier: EngineTier;
  rated: boolean;
  timeControl: TimeControl;
  /** Remaining clock time per side in ms at save point (0/0 when untimed). */
  clocksMs: { w: number; b: number };
  ts: number;
}

export function serializeLiveGame(state: SavedLiveGame): SavedLiveGame {
  return { ...state, movesUci: state.movesUci.trim() };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Shape check only; chess-level legality is verified by replay on restore. */
export function deserializeLiveGame(raw: unknown): SavedLiveGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return null;
  if (!['cpu', 'passplay'].includes(String(s.type))) return null;
  if (typeof s.startFen !== 'string' || !s.startFen) return null;
  if (typeof s.movesUci !== 'string') return null;
  if (!['w', 'b'].includes(String(s.playerColor))) return null;
  if (!isFiniteNumber(s.oppRating) || !['lite', 'full'].includes(String(s.oppTier))) return null;
  if (typeof s.rated !== 'boolean') return null;
  const tc = s.timeControl as Record<string, unknown> | undefined;
  if (!tc || !isFiniteNumber(tc.base) || !isFiniteNumber(tc.inc) || tc.base < 0 || tc.inc < 0) return null;
  const clocks = s.clocksMs as Record<string, unknown> | undefined;
  if (!clocks || !isFiniteNumber(clocks.w) || !isFiniteNumber(clocks.b)) return null;
  if (!isFiniteNumber(s.ts)) return null;
  return {
    version: 1,
    type: s.type as SavedLiveGame['type'],
    startFen: s.startFen,
    movesUci: s.movesUci,
    playerColor: s.playerColor as Color,
    oppRating: s.oppRating,
    oppTier: s.oppTier as EngineTier,
    rated: s.rated,
    timeControl: { base: tc.base, inc: tc.inc },
    clocksMs: { w: clocks.w, b: clocks.b },
    ts: s.ts,
  };
}
