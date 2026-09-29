# Gambit

An offline-first chess PWA for iPhone: a **rating you can trust**, CPU games at your level, and puzzles that fit — all on one unified Lichess-scale rating.

## Features

- **Rating assessment** — an 8-puzzle probe seeds a Glicko-2 prior, then an adaptive staircase vs Stockfish levels (Lichess-calibrated anchors: L1≈800 … L8≈2800) converges your rating-deviation to ±80 or better. Usually 8–14 short games.
- **Play vs CPU at your rating** — the engine strength maps continuously to your rating (Skill Level + UCI_LimitStrength + human-like move randomization). Adjust in Settings. Casual (unrated) until you're assessed, then rated games adjust your rating.
- **Puzzles fit for your rating** — 20,000 curated puzzles from the Lichess database (CC0), filtered for quality (popularity ≥ 70, RD ≤ 100, 2–8 plies), selected in a ±rating window that widens if needed. Strict Lichess-style solving: three tries per puzzle, misses reduce the credit, and every attempt is rated.
- **One unified rating** — games and puzzles both feed a single Glicko-2 rating (τ=0.5, verified against Glickman's worked example in the test suite).
- **Post-game review** — engine scan flags blunders/mistakes/inaccuracies with best-move suggestions and an accuracy estimate.
- **Offline-first** — installable PWA; engine, puzzles, and shell are cached. Plays offline.
- **Local-only data** — everything in IndexedDB on your device; export/import a JSON backup from Settings.

## Quick start

```bash
npm install
npm run setup        # copies engine files + generates icons
npm run puzzles      # one-time: builds the 20k puzzle bundle (~50MB download)
npm run dev          # dev server
npm run build        # production build → dist/
npm test             # Glicko-2 + strength-mapping tests
```

## Put it on your iPhone

### Free hosting (recommended)

```bash
npm run deploy       # builds, then deploys dist/ to Netlify (free tier)
```

(First run asks you to log in / create a Netlify site. Vercel works too: `npx vercel --prod`.)

Then on your iPhone (Safari):

1. Open the site URL.
2. Share button → **Add to Home Screen**.
3. Launch from the home-screen icon — it runs fullscreen and works offline.

### Local network only

```bash
npm run dev          # already listens on your LAN
```

Open `http://<your-computer-ip>:5173` in iPhone Safari (same Wi-Fi). Note: the SW/offline cache needs HTTPS or localhost, so for full offline behavior use the hosted option.

## Notes

- **Engine**: Stockfish 16 NNUE (~40MB one-time download, off by default) and a lite build (~2MB). Both are classic-script WASM workers — no COOP/COEP needed. GPL license applies to the engine binaries.
- **Assessment re-runs**: Settings → Rating → Re-assess options.
- **Rating floor/ceiling**: opponent slider 600–2900.
- **Backup**: Settings → Export backup before clearing browser storage.

## Attribution

- Stockfish (GPL-3.0) via [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) and the npm `stockfish` package.
- Puzzles from the [Lichess puzzle database](https://database.lichess.org) (CC0).
- Pieces: **cburnett** set (via the Lichess project) — for personal use.
