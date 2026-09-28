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
