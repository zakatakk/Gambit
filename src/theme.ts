/** Appearance: style skins (light + dark each), theme preference, accent tint. */

import type { AccentPref, Skin } from './types';

type ThemePref = 'system' | 'light' | 'dark';

export interface SkinOption {
  id: Skin;
  label: string;
  /** Status-bar tint per mode for the iOS theme-color meta. */
  chrome: { light: string; dark: string };
}

/** Every skin ships both modes; Classic is the original editorial look. */
export const SKINS: readonly SkinOption[] = [
  { id: 'classic', label: 'Classic', chrome: { light: '#f4efe6', dark: '#191611' } },
  { id: 'midnight', label: 'Midnight Study', chrome: { light: '#f2ede2', dark: '#14161a' } },
  { id: 'bauhaus', label: 'Bauhaus', chrome: { light: '#f5f2ec', dark: '#16181d' } },
  { id: 'lakehouse', label: 'Lakehouse', chrome: { light: '#eef2ef', dark: '#1a201d' } },
  { id: 'cyber', label: 'Cyber Gambit', chrome: { light: '#0d120e', dark: '#0b0f0c' } },
];

export const ACCENTS: readonly { id: AccentPref; label: string }[] = [
  { id: 'oxblood', label: 'Oxblood' },
  { id: 'forest', label: 'Forest' },
  { id: 'royal', label: 'Royal' },
  { id: 'aubergine', label: 'Aubergine' },
];

export function normalizeSkin(value: unknown): Skin {
  return SKINS.some((skin) => skin.id === value) ? (value as Skin) : 'classic';
}

export function normalizeAccent(value: unknown): AccentPref {
  return ACCENTS.some((accent) => accent.id === value) ? (value as AccentPref) : 'oxblood';
}

const mq = window.matchMedia('(prefers-color-scheme: dark)');

function setChrome(mode: 'light' | 'dark'): void {
  const skin = SKINS.find((s) => s.id === (document.documentElement.dataset.skin ?? 'classic')) ?? SKINS[0];
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = skin.chrome[mode];
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  setChrome(dark ? 'dark' : 'light');
}

export function applySkin(skin: Skin): void {
  document.documentElement.dataset.skin = normalizeSkin(skin);
  // Re-resolve chrome: the skin decides the status-bar tint for both modes.
  const dark = document.documentElement.dataset.theme === 'dark';
  setChrome(dark ? 'dark' : 'light');
}

export function applyAccent(accent: AccentPref): void {
  document.documentElement.dataset.accent = normalizeAccent(accent);
}

export function watchSystemTheme(onChange: () => void): void {
  mq.addEventListener('change', onChange);
}
