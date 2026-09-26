# Gambit — iPhone Setup Guide

Get Gambit on your phone, working offline, with music playing. ~15 minutes, no new accounts needed.

---

## Part 1 — Put it online with GitHub (free, no new accounts)

Since you already have GitHub, you'll use **GitHub Pages**. You push the code; a GitHub Action builds and hosts it automatically.

### 1. Create the repo

1. Go to **github.com/new**.
2. Name it anything, e.g. `gambit`. Keep it **Private** (fine — Pages works on private repos with a free account).
3. Click **Create repository**. Don't add a README.

### 2. Push the code (from the project folder on your computer)

```
git init
git add -A
git commit -m "Gambit chess app"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/gambit.git
git push -u origin main
```

(First push asks you to log in — use your normal GitHub login or a Personal Access Token.)

### 3. Turn on GitHub Pages (one-time)

1. On the repo page: **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. That's it. The workflow (already in the repo at `.github/workflows/deploy.yml`) runs on every push.

### 4. Get your URL

1. Repo → **Actions** tab → wait for "Deploy to GitHub Pages" to go green (~3-5 min; it downloads the puzzle database and builds everything).
2. Your app lives at: **`https://YOURUSERNAME.github.io/gambit/`**

### Updating later

Any `git push` to `main` redeploys automatically. Rating/games/reviews on your phone are untouched.

---

## Part 2 — Install on your iPhone

1. On your iPhone, open **Safari** (must be Safari — other browsers can't install home-screen apps on iOS).
2. Go to `https://YOURUSERNAME.github.io/gambit/`.
3. Wait for the app to load (first load pulls the lite engine, ~2MB).
4. Tap the **Share** button (square with arrow).
5. Scroll → **Add to Home Screen** → **Add**.
6. Launch **Gambit** from the home screen — fullscreen, no browser chrome.

---

## Part 3 — Make it work offline (the train)

One-time, at home on Wi-Fi:

1. Open Gambit from the home-screen icon.
2. **Play tab → New game vs CPU → make one move** (this caches the chess engine).
3. **Puzzles tab** → let one puzzle load (this caches the puzzle set).
4. Done — everything is on the phone now.

**Verify before you travel:** Airplane Mode ON → open Gambit → play moves, solve a puzzle. If that works, the train works.

Notes:

- Always open it from the **home-screen icon**, not a Safari tab.
- The **full NNUE engine upgrade (40MB)** is optional and needs Wi-Fi once. The lite engine (~2MB, cached automatically) caps around 2350 strength — far above human level.

---

## Part 4 — Spotify while you play

Just play music. Gambit's sounds are short effects that **mix with** Spotify, not replace it.

- Spotify → play → switch to Gambit → music keeps going.
- Want total silence from the app? **Settings → Sounds → off.**

---

## Part 5 — Daily use cheat sheet

| What | How |
|---|---|
| Get a rating | Home → **Puzzles + games** (recommended, ~15 min) |
| Play a rated game | Play → **New game vs CPU** (strength = your rating) |
| Solve puzzles | Puzzles tab — one wrong move fails, Lichess-style |
| Review a game | After a game → **Review game** → tap the eval graph to jump around |
| Old reviews | Stats → **Learn** → tap any analysed game |
| Difficulty override | Settings → **Difficulty** slider |
| Strict mode | Settings → toggle (no hints/takebacks) |
| Backup | Settings → Data → **Export data** |
| Re-rate yourself | Settings → Rating → three re-assessment options |

**Important:** your rating/games live in Safari's on-device storage. If you ever clear Safari website data, you wipe Gambit too — export a backup first (monthly is a good habit).

---

## Troubleshooting

- **Actions workflow failed** → Actions tab → click the failed run → read the step. Usually a transient network error on the puzzle download; re-run with **Re-run all jobs**.
- **404 on the Pages URL** → Settings → Pages: is Source = "GitHub Actions"? Did the workflow finish green?
- **"Add to Home Screen" missing** → you're not in Safari, or the page hasn't loaded yet.
- **Won't load offline** → you skipped Part 3, or you opened a stale Safari tab. Open from the home-screen icon once online, make one move, retry.
- **Rating looks wrong** → Settings → Rating → full ladder re-assessment. More games, tighter confidence.

---

## Alternative: Netlify

If you ever prefer it: `npm run deploy` (needs a free Netlify account). The app is configured to work identically at a root domain.
