import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Use ORT's external-WASM build. The default bundle embeds/emits the 28MB
// jsep WebGPU runtime; Maia only needs the 14MB WASM runtime that we copy to
// public/engine/ort and serve from `wasmPaths`.
const ortWasmEntry = fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url));

// base '' → all asset URLs are relative, so the build works at any path:
// root (Netlify) and /repo/ subpaths (GitHub Pages) alike.

// Stamped into every bundle: Settings shows it so a cached (stale) build is
// obvious instead of looking like a feature that never shipped.
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: '',
  resolve: {
    alias: { 'onnxruntime-web': ortWasmEntry }
  },
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
