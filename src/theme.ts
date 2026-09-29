/** Theme handling: system | light | dark, plus accent color selection. */

import type { AccentPref } from './types';

type ThemePref = 'system' | 'light' | 'dark';

interface AccentOption {
  id: AccentPref;
  label: string;
}

const mq = window.matchMedia('(prefers-color-scheme: dark)');

export const ACCENTS: readonly AccentOption[] = [
  { id: 'oxblood', label: 'Oxblood' },
  { id: 'forest', label: 'Forest' },
  { id: 'royal', label: 'Royal' },
  { id: 'aubergine', label: 'Aubergine' },
];

/** Normalize a stored accent to a known id, defaulting to oxblood. */
export function normalizeAccent(value: unknown): AccentPref {
  return ACCENTS.some((accent) => accent.id === value) ? (value as AccentPref) : 'oxblood';
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function applyAccent(accent: AccentPref): void {
  document.documentElement.dataset.accent = normalizeAccent(accent);
}

export function watchSystemTheme(onChange: () => void): void {
  mq.addEventListener('change', onChange);
}
