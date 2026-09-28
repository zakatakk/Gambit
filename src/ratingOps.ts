/** Rating side-effects: update profile and history together through Glicko-2. */
import { rate } from './glicko2';
import { getProfile, saveProfileAndHistory, savePuzzleRatingResult } from './db';
import type { GameResult, Profile, PuzzleAttempt, PuzzleItem, RatingHistoryPoint } from './types';
import type { PuzzleScore } from './puzzleScoring';

const GAME_OPPONENT_RD = 150;
let ratingWrite = Promise.resolve();
let lastHistoryTimestamp = 0;

function serializeRatingWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = ratingWrite.then(write);
  ratingWrite = result.then(() => undefined, () => undefined);
  return result;
}

function nextTimestamp(after = 0): number {
  lastHistoryTimestamp = Math.max(Date.now(), lastHistoryTimestamp + 1, after + 1);
  return lastHistoryTimestamp;
}

function applyToProfile(profile: Profile, next: Profile): void {
  profile.rating = next.rating;
  profile.rd = next.rd;
  profile.volatility = next.volatility;
  profile.lastPlayed = next.lastPlayed;
}

async function saveRatedResult(
  profile: Profile,
  next: Omit<Profile, 'assessed'>,
  kind: RatingHistoryPoint['kind'],
  ts: number,
  attempt?: PuzzleAttempt
): Promise<void> {
  applyToProfile(profile, { ...next, assessed: profile.assessed });
  const point = { ts, rating: next.rating, rd: next.rd, kind };
  if (attempt) await savePuzzleRatingResult(profile, point, attempt);
  else await saveProfileAndHistory(profile, point);
}

export function applyGameResult(opts: {
  oppRating: number;
  result: GameResult;
  kind: 'assessment' | 'game';
}): Promise<{ before: number; after: number; rd: number }> {
  return serializeRatingWrite(async () => {
    const profile = await getProfile();
    const score = opts.result === 'win' ? 1 : opts.result === 'draw' ? 0.5 : 0;
    const ts = nextTimestamp(profile.lastPlayed);
    const next = rate({
      rating: profile.rating,
      rd: profile.rd,
      volatility: profile.volatility,
      lastPlayed: profile.lastPlayed || ts - 8 * 86_400_000,
    }, [{ oppRating: opts.oppRating, oppRd: GAME_OPPONENT_RD, score }], ts);
    const before = profile.rating;
    await saveRatedResult(profile, next, opts.kind, ts);
    return { before, after: next.rating, rd: next.rd };
  });
}

export function applyPuzzleResult(
  puzzle: PuzzleItem,
  score: PuzzleScore,
  attempt: PuzzleAttempt
): Promise<{ before: number; after: number; rd: number }> {
  return serializeRatingWrite(async () => {
    const profile = await getProfile();
    const ts = nextTimestamp(profile.lastPlayed);
    const next = rate({
      rating: profile.rating,
      rd: profile.rd,
      volatility: profile.volatility,
      lastPlayed: profile.lastPlayed || ts - 8 * 86_400_000,
    }, [{ oppRating: puzzle.rating, oppRd: Math.max(60, puzzle.rd), score }], ts);
    const before = profile.rating;
    await saveRatedResult(profile, next, 'puzzle', ts, attempt);
    return { before, after: next.rating, rd: next.rd };
  });
}

/** Seed or overwrite the rating (assessment probe prior or manual override). */
export function setProfileRating(
  rating: number,
  rd: number,
  kind: RatingHistoryPoint['kind'] = 'seed'
): Promise<void> {
  return serializeRatingWrite(async () => {
    const profile = await getProfile();
    const ts = nextTimestamp(profile.lastPlayed);
    const next = { ...profile, rating, rd, lastPlayed: ts };
    await saveRatedResult(profile, next, kind, ts);
  });
}
