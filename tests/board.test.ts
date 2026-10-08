import { describe, expect, it } from 'vitest';
import { boardSquareAt } from '../src/board';

describe('board coordinate orientation', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

  it('maps a-h and 8-1 to the bottom and left edges for White', () => {
    expect(Array.from({ length: 8 }, (_, col) => boardSquareAt(7, col, 'w')))
      .toEqual(files.map((file) => `${file}1`));
    expect(Array.from({ length: 8 }, (_, row) => boardSquareAt(row, 0, 'w')))
      .toEqual(ranks.map((rank) => `a${rank}`));
  });

  it('rotates file and rank coordinates for Black', () => {
    expect(Array.from({ length: 8 }, (_, col) => boardSquareAt(7, col, 'b')))
      .toEqual([...files].reverse().map((file) => `${file}8`));
    expect(Array.from({ length: 8 }, (_, row) => boardSquareAt(row, 0, 'b')))
      .toEqual([...ranks].reverse().map((rank) => `h${rank}`));
  });
});
