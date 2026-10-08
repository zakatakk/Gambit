/**
 * Glicko-2 rating (Glickman, "Example of the Glicko-2 system", Dec 2012).
 * Used for the unified player rating (games + puzzles, Lichess-style scale).
 */

const SCALE = 173.7178;
const TAU = 0.5;
const MS_PER_DAY = 86_400_000;
const MAX_DECAY_DAYS = 120;
const C_SQUARED = (350 * 350 - 50 * 50) / MAX_DECAY_DAYS;
const MAX_VOLATILITY_ITERATIONS = 100;
const VOLATILITY_EPSILON = 1e-7;

export interface RatingState {
  rating: number;
  rd: number;
  volatility: number;
  lastPlayed: number;
}

export interface Match {
  oppRating: number;
  oppRd: number;
  /** Score between 0 (loss) and 1 (win); puzzle attempts can earn partial credit. */
  score: number;
}

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
}

function expectedScore(dr: number, gOfOpp: number): number {
  return 1 / (1 + Math.exp(-gOfOpp * dr));
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`Invalid Glicko-2 ${label}`);
}

function validateRatingInput(state: RatingState, now: number): void {
  assertFinite(state.rating, 'rating');
  assertFinite(state.rd, 'rating deviation');
  assertFinite(state.volatility, 'volatility');
  assertFinite(state.lastPlayed, 'last-played time');
  assertFinite(now, 'update time');
  if (state.rd <= 0 || state.volatility <= 0) {
    throw new RangeError('Glicko-2 RD and volatility must be positive');
  }
}

function validateMatch(match: Match): void {
  assertFinite(match.oppRating, 'opponent rating');
  assertFinite(match.oppRd, 'opponent rating deviation');
  assertFinite(match.score, 'match score');
  if (match.oppRd <= 0 || match.score < 0 || match.score > 1) {
    throw new RangeError('Glicko-2 opponent RD must be positive and score must be between 0 and 1');
  }
}

/** Grow RD after inactivity, per Glickman §5.2 (reaches 350 after ~120 idle days). */
export function growRd(state: RatingState, now = Date.now()): number {
  validateRatingInput(state, now);
  const days = Math.max(0, Math.min((now - state.lastPlayed) / MS_PER_DAY, MAX_DECAY_DAYS));
  return Math.min(Math.sqrt(state.rd * state.rd + C_SQUARED * days), 350);
}

function calculatePeriod(state: RatingState, matches: Match[], now: number): RatingState {
  const mu = (state.rating - 1500) / SCALE;
  const phi = state.rd / SCALE;
  let information = 0;
  let scoreSum = 0;

  for (const match of matches) {
    validateMatch(match);
    const opponentG = g(match.oppRd / SCALE);
    const expected = expectedScore(mu - (match.oppRating - 1500) / SCALE, opponentG);
    information += opponentG * opponentG * expected * (1 - expected);
    scoreSum += opponentG * (match.score - expected);
  }
  assertFinite(information, 'information');
  assertFinite(scoreSum, 'score sum');
  if (information <= 0) throw new RangeError('Glicko-2 matches have no usable information');

  const v = 1 / information;
  const delta = v * scoreSum;
  const a = Math.log(state.volatility * state.volatility);
  const f = (x: number): number => {
    const expX = Math.exp(x);
    const denominator = phi * phi + v + expX;
    return (expX * (delta * delta - phi * phi - v - expX)) / (2 * denominator * denominator)
      - (x - a) / (TAU * TAU);
  };

  let lower = a;
  let upper: number;
  if (delta * delta > phi * phi + v) {
    upper = Math.log(delta * delta - phi * phi - v);
  } else {
    let step = 1;
    while (f(a - step * TAU) < 0 && step < MAX_VOLATILITY_ITERATIONS) step++;
    upper = a - step * TAU;
  }

  let fLower = f(lower);
  let fUpper = f(upper);
  let iterations = 0;
  while (Math.abs(upper - lower) > VOLATILITY_EPSILON && iterations++ < MAX_VOLATILITY_ITERATIONS) {
    const candidate = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    if (!Number.isFinite(candidate)) throw new RangeError('Glicko-2 volatility update did not converge');
    const fCandidate = f(candidate);
    if (fCandidate * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower /= 2;
    }
    upper = candidate;
    fUpper = fCandidate;
  }
  if (iterations >= MAX_VOLATILITY_ITERATIONS && Math.abs(upper - lower) > VOLATILITY_EPSILON) {
    throw new RangeError('Glicko-2 volatility update did not converge');
  }

  const volatility = Math.exp(lower / 2);
  const phiStar = Math.sqrt(phi * phi + volatility * volatility);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + information);
  const newMu = mu + newPhi * newPhi * scoreSum;
  const result = {
    rating: 1500 + SCALE * newMu,
    rd: SCALE * newPhi,
    volatility,
    lastPlayed: now,
  };
  assertFinite(result.rating, 'result rating');
  assertFinite(result.rd, 'result rating deviation');
  assertFinite(result.volatility, 'result volatility');
  return result;
}

/** Update one rating period; inactivity first increases the player's RD. */
export function rate(state: RatingState, matches: Match[], now = Date.now()): RatingState {
  validateRatingInput(state, now);
  if (matches.length === 0) return { ...state, rd: growRd(state, now), lastPlayed: now };
  return calculatePeriod({ ...state, rd: growRd(state, now) }, matches, now);
}

/** Score several games as one period without intermediate inactivity growth. */
export function ratePeriod(state: RatingState, matches: Match[], now = Date.now()): RatingState {
  validateRatingInput(state, now);
  if (matches.length === 0) return { ...state, lastPlayed: now };
  return calculatePeriod(state, matches, now);
}
