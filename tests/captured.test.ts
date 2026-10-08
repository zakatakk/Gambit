import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { capturedSummary } from '../src/captured';

describe('captured material', () => {
  it('is empty and balanced at the start', () => {
    const game = new Chess();
    const summary = capturedSummary(game);
    expect(summary.byWhite).toEqual([]);
    expect(summary.byBlack).toEqual([]);
    expect(summary.balance).toBe(0);
  });

  it('tracks captures and balance after 1.e4 e5 2.Qh5 Ke8 3.Qxe5+', () => {
    const game = new Chess();
    for (const san of ['e4', 'e5', 'Qh5', 'Ke7', 'Qxe5+']) game.move(san);
    const summary = capturedSummary(game);
    expect(summary.byWhite).toEqual(['p']);
    expect(summary.byBlack).toEqual([]);
    expect(summary.balance).toBe(1);
  });

  it('ignores promoted queens beyond the starting set', () => {
    const game = new Chess();
    game.load('QQ6/8/8/8/8/8/8/K6k w - - 0 1');
    const summary = capturedSummary(game);
    // Two white queens on the board: black captured no white queen.
    expect(summary.byBlack).not.toContain('q');
    expect(summary.byBlack).toHaveLength(14); // white's missing r,r,b,b,n,n + 8 pawns
    expect(summary.byWhite).toEqual(['q', 'r', 'r', 'b', 'b', 'n', 'n', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']);
    expect(summary.balance).toBe(9); // 39 (black's missing army) - 30 (white's missing army)
  });

  it('sorts captured pieces largest first', () => {
    const game = new Chess();
    game.load('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
    game.move('Qxf7#');
    const summary = capturedSummary(game);
    expect(summary.byWhite).toEqual(['p']);
  });
});
