/**
 * Opening names: a small ECO table matched by move sequence. This covers the
 * ~120 most common openings/traditional variations a casual player meets.
 * Lookup is prefix-exact on the SAN move list (no transpositions).
 */

import { Chess } from 'chess.js';

/** [SAN moves joined by single spaces, ECO code, name] */
const RAW_TABLE: readonly [string, string, string][] = [
  ['e4', 'B00', "King's Pawn Opening"],
  ['e4 e5', 'C20', 'Open Game'],
  ['e4 e5 Nf3', 'C40', "King's Knight Opening"],
  ['e4 e5 Nf3 Nc6', 'C44', 'Open Game: Normal Variation'],
  ['e4 e5 Nf3 Nc6 Bb5', 'C60', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'C70', 'Ruy Lopez: Morphy Defence'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', 'C78', 'Ruy Lopez: Morphy Defence, Modern Steinitz Defence'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'C65', 'Ruy Lopez: Berlin Defence'],
  ['e4 e5 Nf3 Nc6 Bc4', 'C50', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'C50', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'C55', 'Italian Game: Two Knights Defence'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'C51', 'Evans Gambit'],
  ['e4 e5 Nf3 Nc6 d4', 'C44', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4', 'C45', 'Scotch Game: Main Line'],
  ['e4 e5 Nf3 Nf6', 'C42', 'Petrov Defence'],
  ['e4 e5 Nc3', 'C25', 'Vienna Game'],
  ['e4 e5 f4', 'C30', "King's Gambit"],
  ['e4 e5 Bc4', 'C23', 'Bishop Opening'],
  ['e4 c5', 'B20', 'Sicilian Defence'],
  ['e4 c5 Nf3', 'B27', 'Sicilian Defence'],
  ['e4 c5 Nf3 d6', 'B50', 'Sicilian Defence'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', 'B90', "Sicilian Defence: Najdorf-preparation line"],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'B90', 'Sicilian Defence: Najdorf Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6', 'B99', 'Sicilian Defence: Najdorf, 6.Be2 Main Line'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'B70', 'Sicilian Defence: Dragon Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e5', 'B63', 'Sicilian Defence: Classical Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Bc4', 'B56', 'Sicilian Defence: Moscow Variation'],
  ['e4 c5 Nf3 d6 Bb5+', 'B51', 'Sicilian Defence: Moscow Variation'],
  ['e4 c5 Nf3 Nc6', 'B30', 'Sicilian Defence: Old Sicilian'],
  ['e4 c5 Nf3 e6', 'B40', 'Sicilian Defence: French Variation'],
  ['e4 c5 Nf3 d6 c3', 'B23', 'Sicilian Defence: Alapin Variation'],
  ['e4 c5 Nc3', 'B23', 'Closed Sicilian'],
  ['e4 c5 c3', 'B22', 'Sicilian Defence: Alapin Variation'],
  ['e4 c5 d4', 'B21', 'Sicilian Defence: Smith-Morra Gambit'],
  ['e4 e6', 'C00', 'French Defence'],
  ['e4 e6 d4 d5', 'C01', 'French Defence: Main Line'],
  ['e4 e6 d4 d5 Nc3', 'C10', 'French Defence: Paulsen Variation'],
  ['e4 e6 d4 d5 Nc3 Nf6', 'C11', 'French Defence: Classical Variation'],
  ['e4 e6 d4 d5 Nc3 Bb4', 'C15', 'French Defence: Winawer Variation'],
  ['e4 e6 d4 d5 Nd2', 'C03', 'French Defence: Tarrasch Variation'],
  ['e4 e6 d4 d5 e5', 'C02', 'French Defence: Advance Variation'],
  ['e4 e6 d4 d5 exd5', 'C01', 'French Defence: Exchange Variation'],
  ['e4 c6', 'B10', 'Caro-Kann Defence'],
  ['e4 c6 d4 d5', 'B12', 'Caro-Kann Defence'],
  ['e4 c6 d4 d5 Nc3', 'B15', 'Caro-Kann Defence: Main Line'],
  ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', 'B18', 'Caro-Kann Defence: Classical Variation'],
  ['e4 c6 d4 d5 e5', 'B12', 'Caro-Kann Defence: Advance Variation'],
  ['e4 c6 d4 d5 exd5 cxd5', 'B13', 'Caro-Kann Defence: Exchange Variation'],
  ['e4 d5', 'B01', 'Scandinavian Defence'],
  ['e4 d5 exd5 Qxd5', 'B01', 'Scandinavian Defence: Main Line'],
  ['e4 d5 exd5 Nf6', 'B01', 'Scandinavian Defence: Modern Variation'],
  ['e4 Nf6', 'B02', 'Alekhine Defence'],
  ['e4 g6', 'B06', 'Modern Defence'],
  ['e4 d6', 'B07', 'Pirc Defence'],
  ['e4 d6 d4 Nf6', 'B07', 'Pirc Defence'],
  ['e4 d6 d4 Nf6 Nc3 g6', 'B08', 'Pirc Defence: Main Line'],
  ['e4 g6 d4 Bg7', 'B06', 'Modern Defence'],
  ['e4 d5 Nc3', 'B00', "Nimzowitsch Defence"],
  ['e4 Nc6', 'B00', 'Nimzowitsch Defence'],
  ['d4', 'A40', "Queen's Pawn Opening"],
  ['d4 d5', 'D00', "Queen's Pawn Game"],
  ['d4 d5 c4', 'D06', "Queen's Gambit"],
  ['d4 d5 c4 dxc4', 'D20', "Queen's Gambit Accepted"],
  ['d4 d5 c4 e6', 'D30', "Queen's Gambit Declined"],
  ['d4 d5 c4 e6 Nc3 Nf6', 'D37', "Queen's Gambit Declined: Normal Variation"],
  ['d4 d5 c4 e6 Nc3 Nf6 Bg5', 'D50', "Queen's Gambit Declined: 3.Nf3 Main Line"],
  ['d4 d5 c4 c6', 'D10', 'Slav Defence'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4', 'D15', 'Slav Defence: Main Line'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6', 'D43', 'Semi-Slav Defence: Stoltz Shirov-Shirov Gambit'],
  ['d4 d5 c4 e6 Nc3 c6', 'D31', 'Semi-Slav Defence'],
  ['d4 d5 c4 Nf6', 'D50', "Queen's Gambit Declined: Marshall Defence"],
  ['d4 d5 Nf3', 'D02', "Queen's Pawn Game"],
  ['d4 d5 Nf3 Nf6', 'D02', "Queen's Pawn Game"],
  ['d4 d5 Bf4', 'D02', "Queen's Pawn Game: Accelerated London System"],
  ['d4 d5 e4', 'D00', "Queen's Pawn Game: Blackmar-Diemer Gambit"],
  ['d4 Nf6', 'A45', 'Indian Defence'],
  ['d4 Nf6 c4', 'A50', 'Indian Defence'],
  ['d4 Nf6 c4 e6', 'E00', 'Indian Defence: East Indian Defence'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'E20', 'Nimzo-Indian Defence'],
  ['d4 Nf6 c4 e6 Nf3', 'E00', 'Indian Defence: East Indian Defence'],
  ['d4 Nf6 c4 e6 Nf3 b6', 'E12', "Queen's Indian Defence"],
  ['d4 Nf6 c4 e6 Nf3 d5', 'D30', "Queen's Gambit Declined"],
  ['d4 Nf6 c4 g6', 'D70', 'Indian Defence: King Indian'],
  ['d4 Nf6 c4 g6 Nc3 Bg7', 'E60', "King's Indian Defence"],
  ['d4 Nf6 c4 g6 Nc3 d5', 'D80', 'Grünfeld Defence'],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4', 'D70', "King's Indian Defence: Sämisch Variation"],
  ['d4 f5', 'A80', 'Dutch Defence'],
  ['d4 e6', 'A40', "Horwitz Defence"],
  ['d4 f6', 'A40', 'Barnes Defence'],
  ['d4 d6', 'A41', 'Rat Defence'],
  ['d4 e5', 'A40', 'Englund Gambit'],
  ['d4 g6', 'A40', 'Modern Defence'],
  ['d4 b6', 'A40', 'Owen Defence'],
  ['d4 c5', 'A43', 'Old Benoni'],
  ['d4 e6 c4 Bb4+', 'A40', 'Keres Defence'],
  ['d4 Nf6 Nf3', 'A45', 'Indian Defence: Mongredien Defence'],
  ['d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7', 'D35', "Queen's Gambit Declined: Exchange-free lines"],
  ['c4', 'A10', 'English Opening'],
  ['c4 e5', 'A20', 'English Opening: King English'],
  ['c4 e5 Nc3 Nf6 Nf3 Nc6', 'A29', 'English Opening: Four Knights'],
  ['c4 c5', 'A30', 'English Opening: Symmetrical Variation'],
  ['c4 Nf6', 'A15', 'English Opening: Anglo-Indian Defence'],
  ['c4 e6', 'A13', 'English Opening: Agincourt Defence'],
  ['c4 c6', 'A11', 'English Opening: Caro-Kann Defensive System'],
  ['c4 d5', 'A40', 'English Defence'],
  ['c4 f5', 'A10', 'English Opening: Dutch Defence'],
  ['c4 g6', 'A10', 'English Opening: Great Snake Variation'],
  ['Nf3', 'A04', 'Zukertort Opening'],
  ['Nf3 d5', 'A06', 'Zukertort Opening: Queen Pawn Defence'],
  ['Nf3 d5 g3', 'A07', "King's Indian Attack"],
  ['Nf3 Nf6', 'A05', 'Zukertort Opening: Nimzo-Larsen Variation'],
  ['Nf3 d5 c4', 'D02', "Queen's Pawn Game"],
  ['Nf3 d5 d4 Nf6 c4', 'D06', "Queen's Gambit"],
  ['Nf3 c5', 'A04', 'Zukertort Opening: Sicilian Invitation'],
  ['g3', 'A00', 'Benko Opening'],
  ['b3', 'A01', 'Nimzo-Larsen Attack'],
  ['b4', 'A00', 'Polish Opening'],
  ['f4', 'A02', "Bird's Opening"],
  ['Nc3', 'A00', 'Dunst Opening'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', 'C84', 'Ruy Lopez: Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5', 'C84', 'Ruy Lopez: Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 d6', 'C65', 'Ruy Lopez: Old Steinitz Defence'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5', 'C78', 'Ruy Lopez: Morphy Defence'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2', 'B90', 'Sicilian Defence: Najdorf Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3', 'B90', 'Sicilian Defence: Najdorf, English Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f3', 'B90', 'Sicilian Defence: Najdorf, 6.Be3 English Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 h3', 'B90', 'Sicilian Defence: Najdorf, Adams Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 a6', 'B50', 'Sicilian Defence: Modern Variations'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6', 'B44', 'Sicilian Defence: Taimanov Variation'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6', 'B42', 'Sicilian Defence: Kan Variation'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6', 'B45', 'Sicilian Defence: Taimanov Variation'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', 'B35', 'Sicilian Defence: Accelerated Dragon'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5', 'B54', 'Sicilian Defence: Sveshnikov-preparation line'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6', 'B33', 'Sicilian Defence: Sveshnikov Variation'],
  ['e4 c5 Nf3 Nc6 g3', 'B31', 'Sicilian Defence: Frozen Variation'],
  ['e4 c5 c3 Nf6', 'B22', 'Sicilian Defence: Alapin Variation'],
  ['e4 c5 c3 d5', 'B22', 'Sicilian Defence: Alapin Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6', 'B56', 'Sicilian Defence: Classical'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 e3', 'E40', 'Nimzo-Indian Defence: Rubinstein'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 Qc2', 'E30', 'Nimzo-Indian Defence: Classical'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 Nf3', 'E20', 'Nimzo-Indian Defence: Rubinstein'],
  ['d4 Nf6 c4 g6 Nc3 Bg7 Nf3', 'E60', "King's Indian Defence: Normal Variation"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6', 'E70', "King's Indian Defence: Normal Variation"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2', 'E90', "King's Indian Defence: Classical Variation"],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4', 'D15', 'Slav Defence: Main Line'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6', 'D45', 'Semi-Slav Defence: Main Line'],
  ['d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bf4', 'D37', "Queen's Gambit Declined: Three Knights Variation"],
  ['d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5', 'D50', "Queen's Gambit Declined"],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 d3', 'C50', 'Italian Game: Giuoco Pianissimo'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'C57', 'Italian Game: Two Knights Defence, Fried Liver-ish lines'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 d4', 'C54', 'Italian Game: Two Knights, Max Lange-ish lines'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'C53', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4', 'C54', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5', 'C46', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6', 'C45', 'Scotch Game'],
  ['e4 e5 Nf3 Nf6 Nxe5 d6', 'C42', 'Petrov Defence: Stafford Gambit-ish lines'],
  ['e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4', 'C42', 'Petrov Defence'],
  ['e4 e5 Nc3 Nf6 f4', 'C25', 'Vienna Game: Vienna Gambit'],
  ['e4 e5 Nc3 Nc6', 'C25', 'Vienna Game: Standard Variation'],
  ['e4 e5 Nf3 d6', 'C41', 'Philidor Defence'],
  ['e4 e5 Nf3 Nf6 d4', 'C42', 'Boden-Kieseritzky-ish Petrov lines'],
  ['e4 e5 Nc3 Nf6', 'C25', 'Vienna Game: Standard'],
  ['d4 f5 c4 Nf6', 'A81', 'Dutch Defence: Leningrad-ish lines'],
  ['d4 f5 g3', 'A80', 'Dutch Defence'],
  ['c4 e5 Nc3 Nf6 g3', 'A28', 'English Opening: Four Knights'],
  ['c4 e5 Nc3', 'A21', 'English Opening: Reversed Sicilian'],
  ['c4 Nf6 Nc3', 'A16', 'English Opening: Anglo-Indian Defence'],
  ['c4 Nf6 Nf3', 'A15', 'English Opening: Anglo-Indian Defence'],
  ['c4 c5 Nc3', 'A34', 'English Opening: Symmetrical Variation'],
  ['c4 c5 Nf3', 'A30', 'English Opening: Symmetrical Variation'],
];

// Normalize once: drop check/mate suffixes so table keys like 'Bb5+' match SAN 'Bb5'.
const TABLE: readonly [string, string, string][] = RAW_TABLE.map(([key, eco, name]) =>
  [key.replace(/[+#!?]+/g, '').replace(/\s+/g, ' ').trim(), eco, name]);

export interface OpeningInfo {
  eco: string;
  name: string;
}

const CACHE = new Map<string, OpeningInfo | null>();

/**
 * Name the opening reached by the given legal move history. Accepts verbose or
 * SAN strings; the SAN of each move is used verbatim (chess.js emits 'O-O',
 * '+'/'#' suffixes which the table omits — suffixes are stripped before lookup).
 */
export function detectOpening(history: { san: string }[]): OpeningInfo | null {
  const sans = history.map((move) => move.san.replace(/[+#!?]+$/, ''));
  for (let len = Math.min(sans.length, 10); len > 0; len--) {
    const line = sans.slice(0, len).join(' ');
    if (CACHE.has(line)) return CACHE.get(line) ?? null;
    const hit = TABLE.find(([key]) => key === line);
    CACHE.set(line, hit ? { eco: hit[1], name: hit[2] } : null);
    if (hit) return { eco: hit[1], name: hit[2] };
  }
  return null;
}

/** Convenience: build a Chess from a start FEN and apply UCI moves, ignoring failures. */
export function replayUci(startFen: string, moves: string[]): Chess {
  const game = new Chess(startFen);
  for (const uci of moves) {
    try {
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      continue; // tolerate malformed entries; a review re-analyses from what applies
    }
  }
  return game;
}
