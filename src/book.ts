/**
 * Compact opening book for review "book move" classification.
 * Lines are SAN move sequences (space-separated); a played move is "book"
 * if the position's preceding SAN sequence matches a stored prefix.
 * Derived from common ECO lines — deliberately small, covers the first 4-10 plies
 * of mainstream openings. Genres beyond these fall through to engine judgment.
 */

const BOOK_LINES: string[] = [
  // 1.e4 open games
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O',
  'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7',
  'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O',
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7',
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 Qe2 Qe7 d3',
  'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3',
  'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ng5',
  'e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 exd5 cxd5',
  'e4 e5 d4 exd4 Qxd4 Nc6 Qa4 Nf6',
  // Sicilian
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5 e6',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Nb5 d6',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7',
  'e4 c5 Nc3 Nc6 Nge2 Nf6 d4',
  'e4 c5 c3 Nf6 e5 Nd5 Nf3 Nc6',
  'e4 c5 Nf3 d6 Bb5+ Nd7 O-O Nf6',
  // French
  'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6',
  'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3',
  'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7',
  'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5',
  'e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3',
  'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3',
  // Caro-Kann
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6',
  'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng3 e6',
  'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2',
  'e4 c6 Nc3 d5 Nf3 Bg5',
  // Scandinavian
  'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3',
  'e4 d5 exd5 Nf6 c4 c6 dxc6 Nxc6',
  // Pirc/Modern/Alekhine
  'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O',
  'e4 g6 d4 Bg7 Nc3 d6 Nf3 Nf6 Be2',
  'e4 Nf6 e5 Nd5 d4 d6 Nf3',
  // 1.d4
  'd4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bg5 O-O e3',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7',
  'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5',
  'd4 d5 c4 Nf6 Nc3 e6 Nf3 d5 Bg5',
  'd4 d5 Nf3 Nf6 c4 e6 g3 d5 Bg2',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5',
  'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7',
  'd4 Nf6 c4 c5 Nf3 cxd4 Nxd4 e5 Ndb5',
  'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O',
  'd4 d6 Nf3 Nf6 c4 g6 Nc3 Bg7',
  // 1.c4 / 1.Nf3
  'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3',
  'Nf3 Nf6 g3 g6 Bg2 Bg7 O-O O-O d3',
  'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5',
  'c4 Nf6 Nc3 e6 Nf3 d5 d4',
  'c4 e6 Nc3 Nf6 Nf3 d5 d4',
  'c4 c5 Nf3 Nf6 g3 b6 Bg2 Bb7',
  // Misc responses
  'e4 e5 Nf3 f5 Nxe5 Qf6 d4',
  'd4 e6 c4 b6 Nc3 Bb7',
  'e4 Nc6 d4 d5 Nc3 dxe4',
];

const BOOK_PREFIXES: Set<string> = new Set(
  BOOK_LINES.flatMap((line) => {
    const moves = line.split(' ');
    const prefixes: string[] = [];
    for (let i = 1; i <= moves.length; i++) prefixes.push(moves.slice(0, i).join(' '));
    return prefixes;
  })
);

/** Is the SAN line (all moves so far) still within book? */
export function isBookLine(sanHistory: string[]): boolean {
  return BOOK_PREFIXES.has(sanHistory.join(' '));
}

export const BOOK_LINE_COUNT = BOOK_LINES.length;
