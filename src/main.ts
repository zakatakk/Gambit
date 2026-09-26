import './styles.css';
import { bootApp } from './app';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative: works at root and on GitHub Pages subpaths.
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support unavailable; app still works */
    });
  });
}

bootApp();
