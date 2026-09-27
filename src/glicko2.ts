/**
 * Glicko-2 rating (Glickman, "Example of the Glicko-2 system", Dec 2012).
 * Used for the unified player rating (games + puzzles, Lichess-style scale).
 */

const SCALE = 173.7178;
const TAU = 0.5; // volatility constraint, per paper example
const MS_PER_DAY = 86_400_000;
const MAX_DECAY_DAYS = 120;
const C_SQUARED = (350 * 350 - 50 * 50) / MAX_DECAY_DAYS;

export interface RatingState {
  rating: number;
  rd: number;
  volatility: number;
  lastPlayed: number;
}

export interface Match {
  oppRating: number;
  oppRd: number;
  /** 1 win, 0 loss, 0.5 draw */
  score: 0 | 0.5 | 1;
}

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
}

function expectedScore(dr: number, gOfOpp: number): number {
  return 1 / (1 + Math.exp(-gOfOpp * dr));
}

/** Grow RD after inactivity, per Glickman §5.2 (reaches 350 after ~120 idle days). */
export function growRd(state: RatingState, now = Date.now()): number {
  const days = Math.max(0, Math.min((now - state.lastPlayed) / MS_PER_DAY, MAX_DECAY_DAYS));
  const rd2 = state.rd * state.rd + C_SQUARED * days;
  return Math.min(Math.sqrt(rd2), 350);
}

/** One Glicko-2 update over a rating period (matches the paper's worked example). */
export function rate(state: RatingState, matches: Match[], now = Date.now()): RatingState {
  if (matches.length === 0) {
    return { ...state, rd: growRd(state, now), lastPlayed: now };
  }
  const mu = (state.rating - 1500) / SCALE;
  const phi = state.rd / SCALE;
  const sigma = state.volatility;

  let v = 0;
  let deltaSum = 0;
  for (const m of matches) {
    // Opponent RD must be converted to Glicko-2 scale before g().
    const gj = g(m.oppRd / SCALE);
    const Ej = expectedScore(mu - (m.oppRating - 1500) / SCALE, gj);
    v += gj * gj * Ej * (1 - Ej);
    deltaSum += gj * (m.score - Ej);
  }
  v = 1 / v;
  const delta = deltaSum;

  // Step 1: volatility via the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) /
        (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (TAU * TAU)
    );
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let iter = 0;
  // Paper: iterate until |A - B| < epsilon (1e-6), Illinois method.
  while (Math.abs(A - B) > 1e-6 && iter < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    iter++;
  }
  const newSigma = Math.exp(A / 2);

  // Step 2: new RD.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

  // Step 3: new rating.
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: 1500 + SCALE * newMu,
    rd: SCALE * newPhi,
    volatility: newSigma,
    lastPlayed: now,
  };
}
