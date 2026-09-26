import { defineConfig } from 'vite';

// base '' → all asset URLs are relative, so the build works at any path:
// root (Netlify) and /repo/ subpaths (GitHub Pages) alike.
export default defineConfig({
  base: '',
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
