/** Deep post-game review: eval every position, classify moves, find critical moments. */
import { Chess } from 'chess.js';
import { engine } from './engineClient';
import {
  winPct,
  classify,
  winDrop,
  moveAccuracy,
  aggregateAccuracy,
  phaseSpans,
  CLS_ORDER,
  type MoveCls,
  type MoveEval,
} from './reviewScoring';
import { isBookLine } from './book';
import type { GameRecord } from './types';

const ANALYSE_MS = 220; // per position; a 60-ply game ≈ 15s — tunable

export interface PlyReview {
  ply: number; // 1-based ply (1 = white's first move)
  san: string;
  uci: string;
  fenBefore: string;
  moverIsWhite: boolean;
  cls: MoveCls;
  /** true when the move follows known opening theory (no accuracy penalty) */
  book: boolean;
  winDrop: number;
  moveAccuracy: number;
  /** white-POV eval before this move (cp), for the eval graph */
  evalBeforeCp: number;
  evalAfterCp: number;
  bestUci: string;
  bestSan: string;
  /** top alternatives at the position (uci + cp white POV), best first */
  alternatives: { uci: string; cp: number; san?: string }[];
  pieceCount: number;
}

export interface PlayerReview {
  accuracy: number;
  counts: Record<MoveCls, number>;
  avgWinDrop: number;
  worst: PlyReview | null;
  phases: { name: string; accuracy: number; moves: number }[];
}

export interface DeepReview {
  plies: PlyReview[];
  white: PlayerReview;
  black: PlayerReview;
  evalGraph: { ply: number; cp: number }[]; // position evals, ply 0 = start
  criticalMoments: PlyReview[]; // big swings, chronological
  openingLabel: string;
}

async function analysePosition(fen: string): Promise<{ cp: number; best: string; bestSan: string; alts: { uci: string; cp: number; san?: string }[] }> {
  // Collect every distinct PV head the engine reports (info lines stream at
  // increasing depth; first-seen order = engine ranking, best first).
  const whiteToMove = new Chess(fen).turn() === 'w';
  const seen = new Set<string>();
  const lines: { uci: string; cp: number; san?: string }[] = [];
  await engine.analyse(fen, ANALYSE_MS, (cpStm, pv) => {
    const head = pv[0];
    if (head && !seen.has(head)) {
      seen.add(head);
      lines.push({ uci: head, cp: cpStm, san: sanOfFen(fen, head) });
    }
  });
  const whitePov = lines.map((l) => ({ ...l, cp: whiteToMove ? l.cp : -l.cp }));
  return {
    cp: whitePov[0]?.cp ?? 0,
    best: whitePov[0]?.uci ?? '',
    bestSan: whitePov[0]?.san ?? '?',
    alts: whitePov.slice(0, 3),
  };
}

function sanOfFen(fen: string, uci: string): string {
  const g = new Chess(fen);
  try {
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export async function deepReview(
  rec: GameRecord,
  onProgress: (done: number, total: number, label: string) => void
): Promise<DeepReview> {
  const moves = rec.movesUci.trim().split(/\s+/).filter(Boolean);
  const game = new Chess(rec.startFen);
  const fens: string[] = [game.fen()];
  const pieceCounts: number[] = [];
  const sanList: string[] = [];

  const countPieces = (fen: string) => (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;

  for (const uci of moves) {
    pieceCounts.push(countPieces(game.fen()));
    const mv = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!mv) break;
    sanList.push(mv.san);
    fens.push(game.fen());
  }

  const n = sanList.length;
  const plies: PlyReview[] = [];
  const evalGraph: { ply: number; cp: number }[] = [];

  // Position evals: analyse every position once (0..n), then derive per-move data.
  const posEvals: { cp: number; best: string; bestSan: string; alts: { uci: string; cp: number; san?: string }[] }[] = [];
  for (let i = 0; i <= n; i++) {
    onProgress(i, n + 1, `Analysing position ${i}/${n}`);
    const res = await analysePosition(fens[i]);
    posEvals.push(res);
    evalGraph.push({ ply: i, cp: res.cp });
  }

  // Classify each played move.
  for (let i = 0; i < n; i++) {
    const moverIsWhite = i % 2 === 0;
    const uci = moves[i];
    const bestUci = posEvals[i].best;
    const playedIsBest = uci === bestUci;
    const evalBefore: MoveEval['before'] = { cp: posEvals[i].cp, mate: null };
    const evalAfter: MoveEval['after'] = { cp: posEvals[i + 1].cp, mate: null };
    const evalBest: MoveEval['best'] = { cp: posEvals[i].cp, mate: null };
    const m: MoveEval = { before: evalBefore, after: evalAfter, best: evalBest };
    // winDrop expects "best" as the best-available eval — same as before-eval here.
    const drop = winDrop(m, moverIsWhite);
    // Book: SAN prefix up to (not including) this move matches a known theory line.
    const inBook = isBookLine(sanList.slice(0, i));
    const book = inBook && drop < 40; // even book must not hang a queen
    const cls: MoveCls = book ? 'book' : classify(drop, playedIsBest);

    const beforePov = moverIsWhite ? winPct(posEvals[i].cp) : 100 - winPct(posEvals[i].cp);
    const afterPov = moverIsWhite ? winPct(posEvals[i + 1].cp) : 100 - winPct(posEvals[i + 1].cp);

    plies.push({
      ply: i + 1,
      san: sanList[i],
      uci,
      fenBefore: fens[i],
      moverIsWhite,
      cls,
      book,
      winDrop: drop,
      moveAccuracy: book ? 100 : moveAccuracy(beforePov, afterPov),
      evalBeforeCp: posEvals[i].cp,
      evalAfterCp: posEvals[i + 1].cp,
      bestUci,
      bestSan: posEvals[i].bestSan,
      alternatives: posEvals[i].alts,
      pieceCount: pieceCounts[i],
    });
  }

  const white = summarize(plies.filter((p) => p.moverIsWhite));
  const black = summarize(plies.filter((p) => !p.moverIsWhite));

  // Critical moments: top swings by |eval change| — where the game turned.
  const criticalMoments = [...plies]
    .sort((a, b) => Math.abs(b.evalAfterCp - b.evalBeforeCp) - Math.abs(a.evalAfterCp - a.evalBeforeCp))
    .filter((p) => Math.abs(p.evalAfterCp - p.evalBeforeCp) >= 150)
    .slice(0, 6)
    .sort((a, b) => a.ply - b.ply);

  return {
    plies,
    white,
    black,
    evalGraph,
    criticalMoments,
    openingLabel: detectOpening(sanList.slice(0, 8)),
  };
}

function summarize(moves: PlyReview[]): PlayerReview {
  const counts: Record<MoveCls, number> = { book: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const m of moves) counts[m.cls]++;
  // Book moves are theory, not skill — exclude them from the accuracy calc.
  const scored = moves.filter((m) => !m.book);
  const pairs = scored.map((m) => ({
    before: m.moverIsWhite ? winPct(m.evalBeforeCp) : 100 - winPct(m.evalBeforeCp),
    after: m.moverIsWhite ? winPct(m.evalAfterCp) : 100 - winPct(m.evalAfterCp),
  }));
  const accuracy = scored.length ? aggregateAccuracy(pairs) : 100;
  const avgWinDrop = moves.length ? moves.reduce((s, m) => s + m.winDrop, 0) / moves.length : 0;
  const worst = moves.length
    ? moves.reduce((w, m) => (m.winDrop > w.winDrop ? m : w), moves[0])
    : null;
  const spans = phaseSpans(moves.map((m) => m.pieceCount));
  const phases = spans.map((s) => {
    const seg = moves.slice(s.fromPly, s.toPly);
    const segPairs = seg.map((m) => ({
      before: m.moverIsWhite ? winPct(m.evalBeforeCp) : 100 - winPct(m.evalBeforeCp),
      after: m.moverIsWhite ? winPct(m.evalAfterCp) : 100 - winPct(m.evalAfterCp),
    }));
    return { name: s.name, accuracy: Math.round(aggregateAccuracy(segPairs)), moves: seg.length };
  });
  return { accuracy, counts, avgWinDrop, worst, phases };
}

/** Rough ECO-style opening naming from the first moves. */
export function detectOpening(sanPrefix: string[]): string {
  const line = sanPrefix.join(' ');
  const table: [RegExp, string][] = [
    [/^e4 c6/, 'Caro-Kann Defence'],
    [/^e4 e5 Nf3 Nc6 Bb5/, 'Ruy López'],
    [/^e4 e5 Nf3 Nc6 Bc4/, 'Italian Game'],
    [/^e4 e5 Nf3 Nc6 d4/, 'Scotch Game'],
    [/^e4 e5 Nf3 Nf6/, 'Petrov Defence'],
    [/^e4 e5 Nc3/, 'Vienna Game'],
    [/^e4 e5 f4/, 'King\'s Gambit'],
    [/^e4 e5 Bc4/, 'Bishop\'s Opening'],
    [/^e4 c5 Nf3 d6 d4/, 'Sicilian, Open'],
    [/^e4 c5 Nf3/, 'Sicilian Defence'],
    [/^e4 e6/, 'French Defence'],
    [/^e4 d5/, 'Scandinavian Defence'],
    [/^e4 Nf6/, 'Alekhine Defence'],
    [/^e4 d6/, 'Pirc Defence'],
    [/^e4 g6/, 'Modern Defence'],
    [/^d4 d5 c4/, 'Queen\'s Gambit'],
    [/^d4 d5 c4 e6/, 'QGD'],
    [/^d4 Nf6 c4 g6/, 'King\'s Indian Defence'],
    [/^d4 Nf6 c4 e6/, 'Nimzo/Indian complex'],
    [/^d4 f5/, 'Dutch Defence'],
    [/^Nf3/, 'Zukertort / Réti'],
    [/^c4/, 'English Opening'],
    [/^e4 e5/, 'Open Game'],
    [/^e4/, 'King\'s Pawn'],
    [/^d4/, 'Queen\'s Pawn'],
  ];
  for (const [re, name] of table) {
    if (re.test(line)) return name;
  }
  return 'Irregular';
}

export { CLS_ORDER };
