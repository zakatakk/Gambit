import { defineConfig } from 'vite';

// base '' → all asset URLs are relative, so the build works at any path:
// root (Netlify) and /repo/ subpaths (GitHub Pages) alike.

// Stamped into every bundle: Settings shows it so a cached (stale) build is
// obvious instead of looking like a feature that never shipped.
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: '',
  define: { __APP_VERSION__: JSON.stringify(buildStamp) },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          chess: ['chess.js']
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  server: {
    // Engine worker needs classic script loading; these headers avoid dev quirks on iOS.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  }
});
