/** Tiny WebAudio synth SFX (no assets). Respects the settings toggle via play(). */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundsEnabled(v: boolean): void {
  enabled = v;
}

export function primeAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  delay = 0,
  freqEnd?: number
): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export type SoundName = 'move' | 'capture' | 'check' | 'success' | 'fail' | 'gameEnd';

export function play(name: SoundName): void {
  if (!enabled) return;
  primeAudio();
  if (!ctx) return;
  switch (name) {
    case 'move':
      tone(340, 0.06, 'triangle', 0.25);
      break;
    case 'capture':
      tone(190, 0.09, 'square', 0.22);
      tone(120, 0.12, 'triangle', 0.18, 0.02);
      break;
    case 'check':
      tone(880, 0.09, 'sine', 0.22);
      tone(1174, 0.12, 'sine', 0.2, 0.08);
      break;
    case 'success':
      tone(660, 0.09, 'sine', 0.22);
      tone(880, 0.09, 'sine', 0.22, 0.09);
      tone(1318, 0.16, 'sine', 0.22, 0.18);
      break;
    case 'fail':
      tone(300, 0.15, 'sawtooth', 0.18);
      tone(220, 0.2, 'sawtooth', 0.16, 0.12);
      break;
    case 'gameEnd':
      tone(523, 0.12, 'sine', 0.2);
      tone(392, 0.14, 'sine', 0.2, 0.12);
      break;
  }
}
