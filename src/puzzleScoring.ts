import { Chess } from 'chess.js';

export const PUZZLE_TRY_LIMIT = 3;
export type PuzzleScore = 0 | 0.5 | 0.75 | 1;

/** Each wrong attempt reduces eventual credit; exhausting all three earns no credit. */
export function puzzleScoreForMistakes(mistakes: number): PuzzleScore {
  if (!Number.isInteger(mistakes) || mistakes < 0) {
    throw new RangeError('Puzzle mistakes must be a non-negative integer');
  }
  if (mistakes >= PUZZLE_TRY_LIMIT) return 0;
  return (1 - mistakes * 0.25) as PuzzleScore;
}

export function matchesPuzzleMove(
  move: { from: string; to: string; promotion?: string },
  uci: string | undefined
): boolean {
  if (!uci || move.from !== uci.slice(0, 2) || move.to !== uci.slice(2, 4)) return false;
  if (uci.length <= 4) return !move.promotion;
  return (move.promotion ?? 'q') === uci[4];
}

/** Convert a puzzle's UCI line into standard algebraic notation. */
export function puzzleSolutionSan(fen: string, moves: string[]): string {
  const game = new Chess(fen);
  const san: string[] = [];
  let moveNumber = Number(game.fen().split(' ')[5]) || 1;
  let turn = game.turn();

  for (let i = 0; i < moves.length; i++) {
    const uci = moves[i];
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!move) break;

    if (turn === 'w') {
      san.push(`${moveNumber}.`, move.san);
    } else {
      if (i === 0) san.push(`${moveNumber}...`);
      san.push(move.san);
      moveNumber++;
    }
    turn = turn === 'w' ? 'b' : 'w';
  }

  return san.join(' ');
}
