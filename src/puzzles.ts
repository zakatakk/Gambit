/** Puzzle bundle loading and selection (unified rating on the Lichess scale). */
import type { PuzzleItem } from './types';
import { PUZZLE_BUNDLE_URL } from './version';

let cache: PuzzleItem[] | null = null;

export async function loadPuzzles(): Promise<PuzzleItem[]> {
  if (cache) return cache;
  const res = await fetch(PUZZLE_BUNDLE_URL);
  if (!res.ok) throw new Error(`Puzzle bundle missing (${res.status}). Run: npm run puzzles`);
  const data = (await res.json()) as { puzzles: PuzzleItem[] };
  cache = data.puzzles;
  return cache;
}

/** Pick a random unseen puzzle within the rating window around the player rating. */
export function pickPuzzle(
  all: PuzzleItem[],
  rating: number,
  seen: Set<string>,
  rng: () => number = Math.random
): PuzzleItem | null {
  const window = rating < 1200 ? 250 : rating < 1800 ? 350 : 450;
  let lo = rating - window;
  let hi = rating + window;
  let pool = all.filter((p) => p.rating >= lo && p.rating <= hi && !seen.has(p.id));
  if (pool.length === 0) {
    // Widen progressively; then allow repeats as last resort.
    for (const w of [window * 2, window * 4, Infinity]) {
      pool = all.filter((p) => Math.abs(p.rating - rating) <= w && !seen.has(p.id));
      if (pool.length > 0) break;
    }
    if (pool.length === 0) pool = all.filter((p) => Math.abs(p.rating - rating) <= 300);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}
