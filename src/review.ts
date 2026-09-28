/** Deep post-game review: evaluate positions, classify moves, and find critical moments. */
import { Chess } from 'chess.js';
import { engine } from './engineClient';
import {
  winPct,
  mateScoreValue,
  classify,
  winDrop,
  moveAccuracy,
  aggregateAccuracy,
  phaseSpans,
  type MoveCls,
  type MoveEval,
} from './reviewScoring';
import { isBookLine } from './book';
import type { GameRecord } from './types';

const ANALYSE_MS = 220;

export interface PlyReview {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  moverIsWhite: boolean;
  cls: MoveCls;
  book: boolean;
  winDrop: number;
  moveAccuracy: number;
  evalBeforeCp: number;
  evalBeforeMate: number | null;
  evalAfterCp: number;
  evalAfterMate: number | null;
  bestUci: string;
  bestSan: string;
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
  evalGraph: { ply: number; cp: number }[];
  criticalMoments: PlyReview[];
  openingLabel: string;
}

interface PositionAnalysis {
  cp: number;
  mate: number | null;
  best: string;
  bestSan: string;
  alts: { uci: string; cp: number; san?: string }[];
}

interface Candidate {
  uci: string;
  cp: number | null;
  mate: number | null;
  san: string;
  depth: number;
}

function whiteWinPercent(score: { cp: number; mate: number | null }): number {
  return score.mate === null ? winPct(score.cp) : mateScoreValue(score.mate);
}

function winPercent(score: { cp: number; mate: number | null }, moverIsWhite: boolean): number {
  const whitePercent = whiteWinPercent(score);
  return moverIsWhite ? whitePercent : 100 - whitePercent;
}

function mateScore(mate: number): number {
  return mate > 0 ? 100_000 - mate : -100_000 - mate;
}

async function analysePosition(fen: string): Promise<PositionAnalysis> {
  const position = new Chess(fen);
  const whiteToMove = position.turn() === 'w';
  if (position.isGameOver()) {
    const checkmate = position.isCheckmate();
    return {
      cp: checkmate ? (whiteToMove ? -100_000 : 100_000) : 0,
      mate: checkmate ? (whiteToMove ? -1 : 1) : null,
      best: '',
      bestSan: '—',
      alts: [],
    };
  }

  const latestByMove = new Map<string, Candidate>();
  await engine.analyse(fen, ANALYSE_MS, (cpStm, mateStm, pv, depth) => {
    const uci = pv[0];
    if (!uci) return;
    const previous = latestByMove.get(uci);
    if (previous && previous.depth > depth) return;
    const move = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
    const candidateGame = new Chess(fen);
    let san = uci;
    try { san = candidateGame.move(move).san; } catch { /* UCI fallback */ }
    latestByMove.set(uci, { uci, cp: cpStm, mate: mateStm, san, depth });
  }, 5);

  const candidates = [...latestByMove.values()].map((candidate) => {
    const scoreStm = candidate.cp ?? (candidate.mate === null ? 0 : mateScore(candidate.mate));
    return { ...candidate, cp: whiteToMove ? scoreStm : -scoreStm };
  }).sort((a, b) => whiteToMove ? b.cp - a.cp : a.cp - b.cp);
  const best = candidates[0];
  return {
    cp: best?.cp ?? 0,
    mate: best?.mate === null || best?.mate === undefined ? null : (whiteToMove ? best.mate : -best.mate),
    best: best?.uci ?? '',
    bestSan: best?.san ?? '—',
    alts: candidates.slice(0, 3).map(({ uci, cp, san }) => ({ uci, cp, san })),
  };
}

function pieceCount(fen: string): number {
  return (fen.slice(0, fen.indexOf(' ')).match(/[a-z]/gi) ?? []).length;
}

export async function deepReview(
  record: GameRecord,
  onProgress: (done: number, total: number, label: string) => void
): Promise<DeepReview> {
  const moves = record.movesUci.trim().split(/\s+/).filter(Boolean);
  const game = new Chess(record.startFen);
  const fens = [game.fen()];
  const counts = [pieceCount(fens[0])];
  const sanMoves: string[] = [];
  const whiteToMoveAtStart = game.turn() === 'w';

  for (const uci of moves) {
    const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!move) break;
    sanMoves.push(move.san);
    const fen = game.fen();
    fens.push(fen);
    counts.push(pieceCount(fen));
    if (game.isGameOver()) break;
  }

  moves.length = sanMoves.length;
  const evaluations: PositionAnalysis[] = [];
  const evalGraph: { ply: number; cp: number }[] = [];
  const total = fens.length;
  for (let i = 0; i < total; i++) {
    onProgress(i, total, `Analysing position ${i + 1}/${total}…`);
    const result = await analysePosition(fens[i]);
    evaluations.push(result);
    evalGraph.push({ ply: i, cp: Math.max(-1000, Math.min(1000, result.cp)) });
    onProgress(i + 1, total, `Analysed ${i + 1}/${total} positions`);
  }

  const plies: PlyReview[] = [];
  for (let i = 0; i < moves.length; i++) {
    const moverIsWhite = whiteToMoveAtStart !== (i % 2 === 1);
    const before = evaluations[i];
    const after = evaluations[i + 1];
    const bestUci = before.best;
    const moveEval: MoveEval = {
      before: { cp: before.cp, mate: before.mate },
      after: { cp: after.cp, mate: after.mate },
      best: { cp: before.cp, mate: before.mate },
    };
    const drop = winDrop(moveEval, moverIsWhite);
    const book = isBookLine(sanMoves.slice(0, i + 1)) && drop < 40;
    const moverBefore = winPercent({ cp: before.cp, mate: before.mate }, moverIsWhite);
    const moverAfter = winPercent({ cp: after.cp, mate: after.mate }, moverIsWhite);

    plies.push({
      ply: i + 1,
      san: sanMoves[i],
      uci: moves[i],
      fenBefore: fens[i],
      moverIsWhite,
      cls: book ? 'book' : classify(drop, moves[i] === bestUci),
      book,
      winDrop: drop,
      moveAccuracy: book ? 100 : moveAccuracy(moverBefore, moverAfter),
      evalBeforeCp: before.cp,
      evalBeforeMate: before.mate,
      evalAfterCp: after.cp,
      evalAfterMate: after.mate,
      bestUci,
      bestSan: before.bestSan,
      alternatives: before.alts,
      pieceCount: counts[i],
    });
  }

  const white = summarize(plies.filter((move) => move.moverIsWhite), plies);
  const black = summarize(plies.filter((move) => !move.moverIsWhite), plies);
  const criticalMoments = [...plies]
    .sort((a, b) => {
      const swingA = Math.abs(whiteWinPercent({ cp: a.evalAfterCp, mate: a.evalAfterMate }) -
        whiteWinPercent({ cp: a.evalBeforeCp, mate: a.evalBeforeMate }));
      const swingB = Math.abs(whiteWinPercent({ cp: b.evalAfterCp, mate: b.evalAfterMate }) -
        whiteWinPercent({ cp: b.evalBeforeCp, mate: b.evalBeforeMate }));
      return swingB - swingA;
    })
    .filter((move) => Math.abs(whiteWinPercent({ cp: move.evalAfterCp, mate: move.evalAfterMate }) -
      whiteWinPercent({ cp: move.evalBeforeCp, mate: move.evalBeforeMate })) >= 8)
    .slice(0, 6)
    .sort((a, b) => a.ply - b.ply);

  return {
    plies,
    white,
    black,
    evalGraph,
    criticalMoments,
    openingLabel: detectOpening(sanMoves.slice(0, 8)),
  };
}

function summarize(moves: PlyReview[], gamePlies: PlyReview[]): PlayerReview {
  const counts: Record<MoveCls, number> = { book: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const move of moves) counts[move.cls]++;
  const scored = moves.filter((move) => !move.book);
  const moveIndices = scored.map((move) => gamePlies.indexOf(move));
  const accuracyPairs = scored.map((move) => ({
    before: winPercent({ cp: move.evalBeforeCp, mate: move.evalBeforeMate }, move.moverIsWhite),
    after: winPercent({ cp: move.evalAfterCp, mate: move.evalAfterMate }, move.moverIsWhite),
  }));
  const winPercentSeries = [
    gamePlies.length ? whiteWinPercent({ cp: gamePlies[0].evalBeforeCp, mate: gamePlies[0].evalBeforeMate }) : 50,
    ...gamePlies.map((move) => whiteWinPercent({ cp: move.evalAfterCp, mate: move.evalAfterMate })),
  ];
  const accuracy = scored.length
    ? aggregateAccuracy(accuracyPairs, winPercentSeries, moveIndices)
    : 100;
  const avgWinDrop = moves.length ? moves.reduce((sum, move) => sum + move.winDrop, 0) / moves.length : 0;
  const worst = moves.reduce<PlyReview | null>(
    (current, move) => !current || move.winDrop > current.winDrop ? move : current,
    null
  );
  const allWinPercents = [
    gamePlies.length ? whiteWinPercent({ cp: gamePlies[0].evalBeforeCp, mate: gamePlies[0].evalBeforeMate }) : 50,
    ...gamePlies.map((move) => whiteWinPercent({ cp: move.evalAfterCp, mate: move.evalAfterMate })),
  ];
  const phases = phaseSpans(gamePlies.map((move) => move.pieceCount)).map((span) => {
    const segment = moves.filter((move) => move.ply - 1 >= span.fromPly && move.ply - 1 < span.toPly);
    const scoredSegment = segment.filter((move) => !move.book);
    const pairs = scoredSegment.map((move) => ({
      before: winPercent({ cp: move.evalBeforeCp, mate: move.evalBeforeMate }, move.moverIsWhite),
      after: winPercent({ cp: move.evalAfterCp, mate: move.evalAfterMate }, move.moverIsWhite),
    }));
    const phaseWinPercents = allWinPercents.slice(span.fromPly, span.toPly + 1);
    const moveIndices = scoredSegment.map((move) => move.ply - 1 - span.fromPly);
    return {
      name: span.name,
      accuracy: Math.round(aggregateAccuracy(pairs, phaseWinPercents, moveIndices)),
      moves: segment.length,
    };
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
    [/^d4 d5 c4 e6/, 'Queen\'s Gambit Declined'],
    [/^d4 d5 c4/, 'Queen\'s Gambit'],
    [/^d4 Nf6 c4 g6/, 'King\'s Indian Defence'],
    [/^d4 Nf6 c4 e6/, 'Nimzo/Indian complex'],
    [/^d4 f5/, 'Dutch Defence'],
    [/^Nf3/, 'Zukertort / Réti'],
    [/^c4/, 'English Opening'],
    [/^e4 e5/, 'Open Game'],
    [/^e4/, 'King\'s Pawn'],
    [/^d4/, 'Queen\'s Pawn'],
  ];
  return table.find(([pattern]) => pattern.test(line))?.[1] ?? 'Irregular';
}
