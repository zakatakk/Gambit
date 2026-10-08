import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { detectOpening, replayUci } from '../src/openings';

describe('opening detection', () => {
  it('names the Ruy Lopez and Najdorf by move prefix', () => {
    const ruy = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) ruy.move(san);
    expect(detectOpening(ruy.history({ verbose: true }))).toEqual({ eco: 'C60', name: 'Ruy Lopez' });

    const najdorf = new Chess();
    for (const san of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']) najdorf.move(san);
    expect(detectOpening(najdorf.history({ verbose: true }))?.name).toContain('Najdorf');
  });

  it('falls back to the longest matching prefix and strips check suffixes', () => {
    const moscow = new Chess();
    for (const san of ['e4', 'c5', 'Nf3', 'd6', 'Bb5+']) moscow.move(san);
    expect(detectOpening(moscow.history({ verbose: true }))?.name).toBe('Sicilian Defence: Moscow Variation');
  });

  it('returns null for unknown lines and empty history', () => {
    expect(detectOpening([])).toBeNull();
    const game = new Chess();
    for (const san of ['h4', 'a5', 'Rh2']) game.move(san);
    expect(detectOpening(game.history({ verbose: true }))).toBeNull();
  });

  it('replays UCI move lists, skipping invalid moves', () => {
    const game = replayUci('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'e2e2',
    ]);
    expect(game.history().length).toBe(5);
    expect(detectOpening(game.history({ verbose: true }))?.name).toBe('Ruy Lopez');
  });
});
