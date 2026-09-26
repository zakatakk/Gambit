/** Theme handling: system | light | dark. Applies data-theme attr on <html>. */

export type ThemePref = 'system' | 'light' | 'dark';

const mq = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function watchSystemTheme(onChange: () => void): void {
  mq.addEventListener('change', onChange);
}

const LIGHT = {
  bg: '#f5f2ec',
  surface: '#ffffff',
  text: '#1d1b16',
  sub: '#6b675e',
  accent: '#7a5c2e',
  border: '#e2ddd2',
  boardLight: '#edd6b0',
  boardDark: '#b58863',
  lastMove: 'rgba(255, 213, 79, 0.45)',
  sel: 'rgba(255, 213, 79, 0.6)',
  danger: '#b3261e',
  success: '#2e6b34',
};

const DARK = {
  bg: '#12110f',
  surface: '#1d1b17',
  text: '#e9e4da',
  sub: '#9a948a',
  accent: '#d3a95c',
  border: '#2a2722',
  boardLight: '#8f7858',
  boardDark: '#4d4335',
  lastMove: 'rgba(255, 202, 40, 0.22)',
  sel: 'rgba(255, 202, 40, 0.35)',
  danger: '#e57373',
  success: '#81c995',
};

export function cssVars(dark: boolean): Record<string, string> {
  const c = dark ? DARK : LIGHT;
  return {
    '--bg': c.bg,
    '--surface': c.surface,
    '--text': c.text,
    '--sub': c.sub,
    '--accent': c.accent,
    '--border': c.border,
    '--board-light': c.boardLight,
    '--board-dark': c.boardDark,
    '--last-move': c.lastMove,
    '--sel': c.sel,
    '--danger': c.danger,
    '--success': c.success,
  };
}
