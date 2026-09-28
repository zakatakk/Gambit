# Refinement pass — research & template

Survey of every user-facing string and doc comment in the repo, with the
rewrite plan this pass applies. Principles first, then per-file findings.

## Principles

1. **Write for the player, not the committee.** Short declaratives. No
   throat-clearing ("Setup is simple", "Just play music"), no filler
   adverbs, no double headings.
2. **Drop the vibe.** No editorial asides ("for the train", "bbg",
   "feel super human"), no narrator voice in code. State the fact once,
   where it belongs.
3. **Say what it does, not how it feels.** "~2MB" beats "small download";
   "3 tries per puzzle" beats "Lichess-style, trust me".
4. **Comments explain non-obvious decisions only.** Anything restating the
   line below it goes. Numbers get their units; magic constants get one
   line of why.
5. **Fix facts, not just tone.** Wordy claims that are also wrong get
   corrected (lite engine size, puzzle fail rules, README encoding).

## Findings → actions

### `src/screens/play.ts`
- Idle mode shows `You vs CPU · casual` before any game exists → header
  reads `Gambit` with no subtitle until a game starts (fixed in code by
  clearing the subtitle; the "You vs" prefix stays for real games).
- `topBar` nests `modeLabel` inside a second `.sub` span → one element,
  set in one place.
- `onPointerDown(e, sq, e)` / `tryDrop(e, sq, e)` call sites pass the same
  event twice; the handlers then declare unused `_ev`/`_e` params (same
  slop lives in `src/board.ts`) → drop the unused params.
- `startAssessment('probe')`: `mode = 'probe'` set twice (once before the
  puzzle load, once after) → once.
- `finishGame()`: `wasLadderMode` and `wasLadder` are the same fact → one;
  the two-sentence ladder comment tightened to one line.
- `"Setup is simple."` template line inside `showSetupTips` → "Nf3 is a
  common opening move for White."
- Comment `// 0..2` etc. in `engineStrength.ts` are fine; kept.

### `src/screens/home.ts`
- `startAssessment` plays the `success` jingle when you merely tap an
  assessment tile — a victory sound before anything happens → removed.
- Doc comment "editorial masthead" → "Home screen".

### `src/screens/puzzles.ts`
- Empty state claimed "you solved them all!" even when puzzles were
  skipped or failed → reworded to the actual constraint:
  "No puzzles left in your rating range."
- `setFeedback('Solved!')` retained; "Not quite — X% credit if solved"
  retained (informative, not wordy).

### `src/screens/settings.ts`
- `toast('Full engine ready.')` vs home's `'Full engine ready — strongest
  play unlocked.'` → one shared string, `'Full engine ready.'`
- `exportButton` label `'Export data (backup file)'` → `'Export backup'`;
  `importButton` `'Import data'` → `'Import backup'` (symmetry, less
  chrome).

### `src/board.ts`
- `onPointerDown(e, sq, _ev)` and `tryDrop(_e, sq, _ev)` carry unused,
  duplicated pointer params → dropped; `startDrag` signature unchanged
  (still needs the event).
- Comment `// White: a8 top-left. Black: proper 180° rotation — h1
  top-left.` kept (it earns its place); its wording kept.

### `src/engineStrength.ts`
- Inline comments `// 0..2`, `// .55 -> .30`, `// 140 -> 80` etc. document
  ranges that are already obvious from the formulas → removed; the
  banding rationale comment above the `if` ladder kept (one line per
  band).
- Doc comment "so low ratings feel human" → "so weak levels play
  plausibly human moves" (one clause, no vibes).

### `src/engineProtocol.ts`
- Stray blank line after the doc comment; doc comment rewritten to one
  line: `/** Types shared with the engine worker adapter. */`

### `src/engineClient.ts`
- `// Cache a clone directly as a stream; the engine worker then reuses
  these bytes instead of causing another full network download during
  startup.` → tightened to two clauses (it was two sentences restating
  one idea).

### `README.md`
- **Byte corruption**: UTF-16LE residue ("# \0G\0a\0m\0b\0i\0t…") after
  the last line, present in the committed blob → removed (file now ends
  after the Attribution section, single trailing newline).
- "and a lite build (~8MB)" → "~2MB" (actual: stockfish.js 1.58MB +
  stockfish.wasm 0.56MB).
- "Strict Lichess-style solving: one wrong move fails; every solve is
  rated." → matches current 3-try credit rules: "Three tries per puzzle;
  misses reduce the credit, and every attempt is rated."
- "Plays on the train with no signal." → "Plays offline."
- "Usually 8–14 short games" kept (concrete, useful).
- Quick start block kept verbatim (commands are content).

### `SETUP.md`
- "Get Gambit on your phone, working offline, with music playing. ~15
  minutes, no new accounts needed." → "Gambit on your iPhone in about 15
  minutes — hosted, installed, offline, and rated."
- "Part 3 — Make it work offline (the train)" → "Part 3 — Make it work
  offline"; drop "(must be Safari — other browsers can't install
  home-screen apps on iOS)" → "(Safari only — iOS installs home-screen
  apps from Safari)"; "If that works, the train works." → "If it works
  there, it works on the train." (kept — it's the one line of voice that
  earns its place).
- "Just play music. Gambit's sounds are short effects that mix with
  Spotify, not replace it." → "Gambit's sounds are short effects; they
  mix with Spotify, they don't replace it." (drop "Just").
- Cheat-sheet rows unchanged (they're a table; terse by design).
- "Rating looks wrong" troubleshooting line kept.

### `public/sw.js`
- Header comment `offline-first for the train` → `offline-first shell +
  asset caching`.

### `index.html` / `manifest.webmanifest`
- Meta description identical in both, already one line — kept.

### Left alone (checked, already refined)
`src/app.ts`, `src/ui.ts`, `src/assessment.ts`, `src/db.ts`,
`src/glicko2.ts`, `src/ratingOps.ts`, `src/review.ts`,
`src/reviewScoring.ts`, `src/puzzles.ts`, `src/puzzleScoring.ts`,
`src/book.ts`, `src/sounds.ts`, `src/theme.ts`, `src/version.ts`,
`src/main.ts`, `src/pieces.ts`, `src/screens/stats.ts`,
`src/screens/reviewView.ts`, `vite.config.ts`, `deploy.yml`, tests.
The previous review pass (fb4532a) already tightened these; nothing in
them is wordy or wrong. `stats.ts` "Learn" section copy and
`reviewView.ts` sheet copy are terse and user-tested as-is.

## Untracked files (no action)

`p3.log`, `preview.log`, `preview2.log`, `vite.log` are tracked but are
build/preview logs committed by accident. `.gitignore` already lists
`vite.log`/`preview.log`. They are not part of this pass; flagged for a
future cleanup commit if wanted (`git rm --cached`), deliberately not
mixed into this copy pass.

## Commit plan

1. `docs+copy: refinement pass` — every change above, one commit.
2. Push `HEAD:refs/heads/main` to `https://github.com/zakatakk/Gambit.git`
   (fast-forward; no force).
