import { describe, expect, it } from 'vitest';
import { ChessClock, formatClock } from '../src/clock';

describe('chess clock', () => {
  it('does not tick when untimed', () => {
    let t = 0;
    const clock = new ChessClock({ base: 0, inc: 0 }, 'w', () => t);
    expect(clock.timed).toBe(false);
    t = 60_000;
    expect(clock.remainingMs('w')).toBe(0);
    expect(clock.flagged()).toBe(false);
  });

  it('ticks only the side to move', () => {
    let t = 0;
    const clock = new ChessClock({ base: 60, inc: 0 }, 'w', () => t);
    t = 10_000;
    expect(clock.remainingMs('w')).toBe(50_000);
    expect(clock.remainingMs('b')).toBe(60_000);
  });

  it('grants increment on the mover side and flips', () => {
    let t = 0;
    const clock = new ChessClock({ base: 60, inc: 3 }, 'w', () => t);
    t = 5_000; // white thinks 5s
    clock.movePlayed(); // 60-5+3 = 58; black's turn
    expect(clock.remainingMs('w')).toBe(58_000);
    t = 8_000; // black thinks 3s
    expect(clock.remainingMs('b')).toBe(57_000);
    expect(clock.remainingMs('w')).toBe(58_000);
  });

  it('flags when the side to move hits zero', () => {
    let t = 0;
    const clock = new ChessClock({ base: 60, inc: 0 }, 'w', () => t);
    t = 61_000;
    expect(clock.flagged()).toBe(true);
    expect(clock.remainingMs('w')).toBe(0);
  });

  it('never counts below zero and clamps restored times', () => {
    let t = 0;
    const clock = new ChessClock({ base: 10, inc: 0 }, 'w', () => t, { w: 4_000, b: 99_000 });
    t = 5_000;
    expect(clock.remainingMs('w')).toBe(0);
    expect(clock.remainingMs('b')).toBe(10_000);
  });

  it('freezes while paused so browsing history costs no time', () => {
    let t = 0;
    const clock = new ChessClock({ base: 60, inc: 0 }, 'w', () => t);
    t = 5_000;
    clock.pause(); // banks the 5s already spent
    expect(clock.paused).toBe(true);
    expect(clock.remainingMs('w')).toBe(55_000);
    t = 30_000; // a long look at an earlier position
    expect(clock.remainingMs('w')).toBe(55_000);
    expect(clock.flagged()).toBe(false);
    clock.resume();
    expect(clock.paused).toBe(false);
    t = 32_000;
    expect(clock.remainingMs('w')).toBe(53_000);
  });

  it('ignores pause and resume when untimed or already in that state', () => {
    let t = 0;
    const untimed = new ChessClock({ base: 0, inc: 0 }, 'w', () => t);
    untimed.pause();
    untimed.resume();
    expect(untimed.paused).toBe(false);

    const clock = new ChessClock({ base: 30, inc: 0 }, 'w', () => t);
    clock.pause();
    t = 1_000;
    clock.pause(); // second pause keeps the banked value
    expect(clock.remainingMs('w')).toBe(30_000);
    clock.resume();
    clock.resume(); // second resume does not restart the tick from a stale stamp
    t = 3_000;
    expect(clock.remainingMs('w')).toBe(28_000);
  });
});

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('shows tenths under 20 seconds', () => {
    expect(formatClock(12_340)).toBe('12.4');
    expect(formatClock(9_400)).toBe('9.4');
    expect(formatClock(0)).toBe('0:00');
  });
});
