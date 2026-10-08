import { describe, expect, it } from 'vitest';
import { deserializeLiveGame, serializeLiveGame } from '../src/liveGame';

const SAMPLE = {
  version: 1,
  type: 'cpu',
  startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  movesUci: 'e2e4 e7e5 g1f3',
  playerColor: 'w',
  oppRating: 1500,
  oppTier: 'lite',
  rated: true,
  timeControl: { base: 300, inc: 3 },
  clocksMs: { w: 280_000, b: 295_000 },
  ts: 1_700_000_000_000,
};

describe('live game snapshots', () => {
  it('round-trips a valid snapshot', () => {
    const saved = serializeLiveGame(SAMPLE as never);
    expect(deserializeLiveGame(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('rejects corrupted or foreign payloads', () => {
    expect(deserializeLiveGame(null)).toBeNull();
    expect(deserializeLiveGame('x')).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, version: 2 })).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, type: 'assessment' })).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, playerColor: 'green' })).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, timeControl: { base: -1, inc: 0 } })).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, clocksMs: { w: 1 } })).toBeNull();
    expect(deserializeLiveGame({ ...SAMPLE, rated: 'yes' })).toBeNull();
  });
});
