import { describe, expect, it } from 'vitest';
import { isBookLine } from '../src/book';

describe('book', () => {
  it('Italian Game opening is book through ply 10', () => {
    const line = 'e4 e5 Nf3 Nc6 Bc4 Bc5'.split(' ');
    for (let i = 1; i <= line.length; i++) {
      expect(isBookLine(line.slice(0, i))).toBe(true);
    }
  });

  it('leaving theory stops being book', () => {
    expect(isBookLine('e4 e5 Nf3 Nc6 Bc4 Bc5 b4'.split(' '))).toBe(true);
    expect(isBookLine('e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4'.split(' '))).toBe(true);
    // A dubious sideline is not in the book.
    expect(isBookLine('e4 e5 Nf3 Nc6 Bc4 Na6'.split(' '))).toBe(false);
  });

  it('French and Sicilian mainlines recognized', () => {
    expect(isBookLine('e4 e6 d4 d5 Nc3 Bb4 e5 c5'.split(' '))).toBe(true);
    expect(isBookLine('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'.split(' '))).toBe(true);
  });

  it('random shuffle is not book', () => {
    expect(isBookLine('h3 a5 Na3 Nh6'.split(' '))).toBe(false);
    expect(isBookLine([])).toBe(false);
  });
});
