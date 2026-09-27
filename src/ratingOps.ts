/**
 * Rating side-effects: apply a game or puzzle result to the profile via Glicko-2,
 * record history, and keep the DB in sync.
 */
import { rate } from './glicko2';
import { addHistory, getProfile, saveProfile } from './db';
import type { GameResult, PuzzleItem } from './types';

/** Assessment opponents use a fixed nominal RD of 150 (moderately certain). */
const OPP_RD = 150;

function applyToProfile(
  profile: Awaited<ReturnType<typeof getProfile>>,
  next: { rating: number; rd: number; volatility: number; lastPlayed: number }
): void {
  profile.rating = next.rating;
  profile.rd = next.rd;
  profile.volatility = next.volatility;
  profile.lastPlayed = next.lastPlayed;
}

export async function applyGameResult(opts: {
  oppRating: number;
  result: GameResult;
  kind: 'assessment' | 'game';
}): Promise<{ before: number; after: number; rd: number }> {
  const profile = await getProfile();
  const score: 0 | 0.5 | 1 = opts.result === 'win' ? 1 : opts.result === 'draw' ? 0.5 : 0;
  const next = rate(
    {
      rating: profile.rating,
      rd: profile.rd,
      volatility: profile.volatility,
      lastPlayed: profile.lastPlayed || Date.now() - 8 * 86_400_000,
    },
    [{ oppRating: opts.oppRating, oppRd: OPP_RD, score }],
    Date.now()
  );
  const before = profile.rating;
  applyToProfile(profile, next);
  await saveProfile(profile);
  await addHistory({
    ts: Date.now(),
    rating: next.rating,
    rd: next.rd,
    kind: opts.kind,
  });
  return { before, after: next.rating, rd: next.rd };
}

export async function applyPuzzleResult(
  puzzle: PuzzleItem,
  won: boolean
): Promise<{ before: number; after: number; rd: number }> {
  const profile = await getProfile();
  const next = rate(
    {
      rating: profile.rating,
      rd: profile.rd,
      volatility: profile.volatility,
      lastPlayed: profile.lastPlayed || Date.now() - 8 * 86_400_000,
    },
    [{ oppRating: puzzle.rating, oppRd: Math.max(60, puzzle.rd), score: won ? 1 : 0 }],
    Date.now()
  );
  const before = profile.rating;
  applyToProfile(profile, next);
  await saveProfile(profile);
  await addHistory({ ts: Date.now(), rating: next.rating, rd: next.rd, kind: 'puzzle' });
  return { before, after: next.rating, rd: next.rd };
}

/** Seed/overwrite the rating (assessment probe prior, manual override). */
export async function setProfileRating(rating: number, rd: number): Promise<void> {
  const profile = await getProfile();
  profile.rating = rating;
  profile.rd = rd;
  profile.lastPlayed = Date.now();
  await saveProfile(profile);
  await addHistory({ ts: Date.now(), rating, rd, kind: 'seed' });
}
