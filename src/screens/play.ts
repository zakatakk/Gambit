/** Play: CPU games + assessment (puzzle probe + staircase ladder). */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { engine } from '../engineClient';
import { ratingToStrength, ASSESSMENT_LEVELS } from '../engineStrength';
import { applyGameResult } from '../ratingOps';
import { getProfile, getSettings, addGame } from '../db';
import { play } from '../sounds';
import { el, modal, toast } from '../ui';
import type { App } from '../app';
import type { Color, GameResult, GameRecord, PuzzleItem } from '../types';
import {
  newAssessment,
  priorFromPuzzles,
  nextLevel,
  assessmentDone,
  LADDER_DEFAULT_PRIOR,
  type AssessmentState,
} from '../assessment';
import type { AssessmentPuzzle } from '../assessment';
import { loadPuzzles } from '../puzzles';
import { openReview } from './reviewView';

interface PlayParams {
  assessment?: boolean;
  mode?: 'probe' | 'ladder' | 'quick';
  rematch?: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function mountPlay(container: HTMLElement, app: App, params: PlayParams): Promise<void> {
  const settings = await getSettings();
  const game = new Chess();

  // ---------- state ----------
  let playerColor: Color = 'w';
  let oppRating = 1500;
  let oppName = 'CPU';
  let thinking = false;
  let mode: 'idle' | 'game' | 'probe' | 'ladder' = 'idle';
  let assessed = (await getProfile()).assessed;
  let lastLevel = 2;
  let assess: AssessmentState = newAssessment();
  let probe: { puzzle: AssessmentPuzzle; step: number } | null = null;
  let probePool: PuzzleItem[] = [];
  let lastResult: 'win' | 'loss' | 'draw' = 'draw';

  // ---------- DOM ----------
  const boardHost = el('div', { class: 'board-wrap' });
  const opponentLabel = el('span', {}, 'CPU');
  const modeLabel = el('span', { class: 'sub' }, ' · casual');
  const topBar = el('div', { class: 'game-top' },
    el('span', { class: 'vs' }, 'You vs ', opponentLabel),
    el('span', { class: 'sub' }, modeLabel));
  const statusBar = el('div', { class: 'status-bar' }, '');
  const moveList = el('div', { class: 'move-list' }, '—');
  const controls = el('div', { class: 'section' });
  const board = new Board(boardHost, game, {
    orientation: 'w',
    interactive: false,
    onMove: (m) => void onUserMove(m),
  });
  const wrap = el('div', {},
    topBar,
    boardHost,
    statusBar,
    controls
  );
  container.appendChild(wrap);

  function setStatus(s: string, cls = ''): void {
    statusBar.textContent = s;
    statusBar.className = `status-bar ${cls}`;
  }

  function renderMoves(): void {
    const hist = game.history({ verbose: true });
    if (hist.length === 0) {
      moveList.textContent = '—';
      return;
    }
    moveList.textContent = '';
    for (let i = 0; i < hist.length; i += 2) {
      moveList.append(
        el('span', { class: 'ply' },
          el('span', { class: 'num' }, `${i / 2 + 1}.`),
          ` ${hist[i].san}${hist[i + 1] ? ' ' + hist[i + 1].san : ''}`)
      );
    }
  }

  function controlsDefault(): void {
    controls.textContent = '';
    if (assessed) {
      controls.append(
        el('p', { class: 'kicker' }, 'Rated play'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'primary', onclick: () => void startGame() }, 'New game vs CPU')),
      el('p', { class: 'tiny', style: 'margin:6px 0 0' },
        'Rated · CPU strength follows your rating'),
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('span', { class: 'muted' }, 'Moves'), el('span', {}, '')),
        moveList
      );
      return;
    }
    // Unrated: offer the three assessment modes.
    controls.append(
      el('p', { class: 'kicker' }, 'Establish a rating'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'primary', onclick: () => void startAssessment('probe') }, 'Puzzles + games')),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => void startAssessment('ladder') }, 'Full ladder')),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => void startAssessment('quick') }, 'Quick scan')),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'You can re-run any assessment later from Settings.'),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('span', { class: 'muted' }, 'Moves'), el('span', {}, '')),
      moveList
    );
  }

  function controlsInGame(allowHelpers: boolean): void {
    controls.textContent = '';
    controls.append(
      moveList,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { onclick: () => resign() }, 'Resign'),
        allowHelpers ? el('button', { onclick: () => void hint() }, 'Hint') : null,
        allowHelpers ? el('button', { onclick: () => takeback() }, 'Takeback') : null)
    );
  }

  function controlsProbe(): void {
    controls.textContent = '';
    controls.append(
      moveList,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { onclick: () => skipProbe() }, 'Skip')),
      el('p', { class: 'muted', style: 'margin:6px 0 0' },
        'Find the best move for the highlighted side. One wrong move fails the puzzle.')
    );
  }

  function skipProbe(): void {
    if (mode !== 'probe') return;
    const pz = assess.puzzles[probeIndex];
    if (pz && pz.won === undefined) pz.won = false;
    setStatus('Skipped — counts as unsolved.', 'lose');
    setTimeout(() => finishProbe(false), 400);
  }

  // ---------- engine helpers ----------
  async function ensureEngine(onStatus: (s: string) => void): Promise<void> {
    await engine.init(settings.engineTier, (phase, frac) => {
      if (phase === 'download') onStatus(`Downloading engine ${Math.round(frac * 100)}%`);
      else onStatus('Booting engine…');
    });
  }

  // ---------- game flow ----------
  async function startGame(opts?: { color?: Color; rating?: number; ladder?: boolean }): Promise<void> {
    const p = await getProfile();
    oppRating = Math.round(opts?.rating ?? p.rating);
    playerColor = opts?.color ?? (Math.random() < 0.5 ? 'w' : 'b');
    oppName = opts?.ladder
      ? `Stockfish ${ASSESSMENT_LEVELS[lastLevel].label} (~${ASSESSMENT_LEVELS[lastLevel].rating})`
      : `CPU ${oppRating}`;
    opponentLabel.textContent = oppName;
    modeLabel.textContent = opts?.ladder ? ' · assessment' : assessed ? ' · rated' : ' · casual';
    mode = opts?.ladder ? 'ladder' : 'game';

    game.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    board.setOrientation(playerColor);
    board.setLastMove(null);
    board.setInteractive(false);
    board.deselect();
    renderMoves();
    controlsInGame(!opts?.ladder && !settings.strictMode);
    setStatus('Loading engine…');
    try {
      await ensureEngine((s) => setStatus(s));
    } catch (e) {
      setStatus(`Engine failed to load: ${(e as Error).message}`, 'lose');
      return;
    }
    setStatus(playerColor === 'w' ? 'Your move — you play White' : `You play Black. ${oppName} starts…`);
    board.setInteractive(game.turn() === playerColor);
    if (game.turn() !== playerColor) void engineMove();
  }

  async function engineMove(): Promise<void> {
    if (mode !== 'game' && mode !== 'ladder') return;
    if (game.isGameOver()) return;
    thinking = true;
    board.setInteractive(false);
    setStatus(`${oppName} is thinking…`);
    const strength = ratingToStrength(oppRating, settings.engineTier);
    try {
      const mv = await engine.play(game.fen(), strength);
      thinking = false;
      if (mode !== 'game' && mode !== 'ladder') return;
      applyMove(mv, false);
    } catch (e) {
      thinking = false;
      setStatus(`Engine error: ${(e as Error).message}`, 'lose');
    }
  }

  function applyMove(mv: { from: string; to: string; promotion?: string }, byPlayer: boolean): boolean {
    const move = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
    if (!move) return false;
    board.setLastMove({ from: mv.from, to: mv.to });
    board.render();
    renderMoves();
    play(move.captured ? 'capture' : 'move');
    if (game.isGameOver()) {
      finishGame();
      return true;
    }
    if (game.inCheck()) play('check');
    if (mode === 'game' || mode === 'ladder') {
      const myTurn = game.turn() === playerColor;
      board.setInteractive(myTurn && !thinking);
      setStatus(myTurn ? 'Your move' : `${oppName} is thinking…`);
      if (!myTurn) void engineMove();
    } else if (mode === 'probe') {
      void handleProbeMove(null, byPlayer);
    }
    return true;
  }

  async function onUserMove(m: { from: string; to: string; promotion?: string }): Promise<void> {
    if (thinking) return;
    if (mode === 'probe') {
      await handleProbeMove(m, true);
      return;
    }
    if (mode !== 'game' && mode !== 'ladder') return;
    if (game.turn() !== playerColor) return;
    if (!applyMove(m, true)) return;
  }

  // ---------- end of game ----------
  function resultFromGameOver(): { result: GameResult; termination: string } {
    if (game.isCheckmate()) {
      const loser = game.turn();
      return { result: loser === playerColor ? 'loss' : 'win', termination: 'checkmate' };
    }
    if (game.isStalemate()) return { result: 'draw', termination: 'stalemate' };
    if (game.isInsufficientMaterial()) return { result: 'draw', termination: 'insufficient material' };
    if (game.isThreefoldRepetition()) return { result: 'draw', termination: 'threefold repetition' };
    if (game.isDraw()) return { result: 'draw', termination: 'draw' };
    return { result: 'draw', termination: 'game over' };
  }

  function finishGame(termination?: string, forced?: GameResult): void {
    const r = forced
      ? { result: forced, termination: termination ?? 'resignation' }
      : resultFromGameOver();
    board.setInteractive(false);
    const wasLadderMode = mode === 'ladder';
    mode = 'idle';
    lastResult = r.result === 'abandoned' ? 'draw' : r.result;
    const msg =
      r.result === 'win' ? 'You win!' : r.result === 'loss' ? 'You lost.' : 'Draw.';
    setStatus(`${msg} (${r.termination})`, r.result === 'win' ? 'win' : r.result === 'loss' ? 'lose' : '');
    play('gameEnd');
    const movesUci = game
      .history({ verbose: true })
      .map((h) => h.from + h.to + (h.promotion ?? ''))
      .join(' ');
    const rec: GameRecord = {
      ts: Date.now(),
      type: wasLadderMode ? 'assessment' : 'cpu',
      color: playerColor,
      result: r.result,
      movesUci,
      startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      opponentRating: oppRating,
      opponentTier: settings.engineTier,
      rated: assessed && !wasLadderMode,
      termination: r.termination,
    };
    const wasLadder = rec.type === 'assessment';
    const wasAssessed = assessed;
    void (async () => {
      await addGame(rec);
      if (wasLadder) {
        // Ladder games are scored as one batched rating period in
        // onLadderGameFinished() — no sequential update here.
      } else if (wasAssessed) {
        const { before, after } = await applyGameResult({
          oppRating,
          result: r.result,
          kind: 'game',
        });
        rec.ratingBefore = before;
        rec.ratingAfter = after;
        toast(`Rating: ${Math.round(before)} → ${Math.round(after)}`);
      }
      showPostGame(rec);
    })();
  }

  function showPostGame(rec: GameRecord): void {
    const ratingLine = rec.ratingAfter
      ? el('p', { class: 'muted' },
          `Rating ${Math.round(rec.ratingBefore ?? 0)} → `, el('b', {}, String(Math.round(rec.ratingAfter))))
      : undefined;
    // Ladder advances FIRST (renders next game), then the result sheet overlays it.
    if (rec.type === 'assessment') setTimeout(() => onLadderGameFinished(), 0);
    const reviewBtn = el('button', { onclick: () => doReview(rec) }, 'Review game');
    const closeSheet = modal(
      el('h2', {}, rec.result === 'win' ? 'Victory' : rec.result === 'loss' ? 'Defeat' : 'Draw'),
      ...(ratingLine ? [ratingLine as Node] : []),
      el('p', { class: 'muted' }, `vs ${oppName} · ${rec.termination} · ${game.history().length} plies`),
      el('div', { class: 'btn-row' },
        reviewBtn,
        rec.type === 'assessment'
          ? el('button', { onclick: () => closeSheet() }, 'Continue')
          : el('button', { onclick: () => { closeSheet(); void startGame(); } }, 'Play again'),
        el('button', { onclick: () => { closeSheet(); controlsDefault(); } }, 'Done'))
    );
  }

  function doReview(rec: GameRecord): void {
    void openReview(rec);
  }

  // ---------- helpers ----------
  async function hint(): Promise<void> {
    if (thinking || game.turn() !== playerColor) return;
    setStatus('Thinking…');
    try {
      const mv = await engine.analyse(game.fen(), 600, () => {});
      if (!mv) throw new Error('no move');
      setStatus(`Hint: consider ${sanOf(mv)}`);
    } catch {
      setStatus('Hint unavailable.');
    }
  }

  function takeback(): void {
    if (thinking || game.history().length === 0) return;
    if (game.turn() === playerColor && game.history().length >= 2) game.undo();
    game.undo();
    board.setLastMove(null);
    board.render();
    renderMoves();
    board.setInteractive(true);
    setStatus('Takeback — your move.');
  }

  function resign(): void {
    if (mode !== 'game' && mode !== 'ladder') return;
    finishGame('resignation', 'loss');
  }

  function sanOf(mv: { from: string; to: string; promotion?: string }): string {
    const c = new Chess(game.fen());
    try {
      return c.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' }).san;
    } catch {
      return `${mv.from}→${mv.to}`;
    }
  }

  async function startAssessment(chosenMode: 'probe' | 'ladder' | 'quick' = 'probe'): Promise<void> {
    assess = newAssessment(chosenMode);
    probePool = [];
    if (chosenMode === 'probe') {
      const all = await loadPuzzles().catch(() => [] as PuzzleItem[]);
      if (all.length === 0) {
        toast('Puzzle bundle missing — run: npm run puzzles');
        return;
      }
      // Probe: 8 puzzles around 1200-1800 to bracket the prior.
      const band = all.filter((p) => p.rating >= 1100 && p.rating <= 1900);
      probePool = shuffle(band.length >= 8 ? band : all).slice(0, 8);
      assess.puzzles = probePool.map((p) => ({ ...p })) as AssessmentPuzzle[];
      assess.phase = 'puzzles';
      mode = 'probe';
      probeIndex = 0;
      opponentLabel.textContent = 'Assessment';
      modeLabel.textContent = ' · puzzle probe 1/8';
      controlsProbe();
      setStatus('Solve: find the best move.');
      loadProbe(0);
      return;
    }
    // ladder / quick: straight to games from the default prior.
    const prior = { ...LADDER_DEFAULT_PRIOR };
    assess.prior = prior;
    const { setProfileRating } = await import('../ratingOps');
    await setProfileRating(prior.rating, prior.rd);
    assess.phase = 'games';
    lastLevel = levelForRating(prior.rating);
    assess.currentLevel = lastLevel;
    mode = 'idle';
    toast(chosenMode === 'quick' ? 'Quick scan — 6 games.' : 'Ladder — from level 3 (~1200).');
    void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
  }

  let probeIndex = 0;

  function loadProbe(i: number): void {
    probeIndex = i;
    controlsProbe();
    const pz = assess.puzzles[i];
    probe = { puzzle: pz, step: 0 };
    // Lichess FEN is before the opponent's pre-move; play it to reach the solve position.
    const g = new Chess(pz.fen);
    const oppMove = pz.moves[0];
    g.move({ from: oppMove.slice(0, 2), to: oppMove.slice(2, 4), promotion: oppMove[4] });
    game.load(g.fen());
    // The solver plays the side that is to move AFTER the pre-move.
    playerColor = g.turn();
    board.setOrientation(playerColor);
    board.setLastMove({ from: oppMove.slice(0, 2), to: oppMove.slice(2, 4) });
    board.setInteractive(true);
    board.render();
    moveList.textContent = `Puzzle ${i + 1} of ${assess.puzzles.length}`;
    modeLabel.textContent = ` · puzzle probe ${i + 1}/${assess.puzzles.length}`;
  }

  async function handleProbeMove(m: { from: string; to: string; promotion?: string } | null, byPlayer: boolean): Promise<void> {
    if (!probe) return;
    const pz = probe.puzzle;
    const solution = pz.moves.slice(1); // after opponent's opening move
    const step = probe.step;

    if (!byPlayer) {
      // Engine's scripted reply
      const reply = solution[step];
      if (reply) {
        const mv = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
        if (!mv) {
          finishProbe(true);
          return;
        }
        board.setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
        board.render();
        probe.step++;
        if (probe.step >= solution.length) finishProbe(true);
        return;
      }
      finishProbe(true);
      return;
    }

    if (!m) return;
    const expected = solution[step];
    const ok = expected && m.from === expected.slice(0, 2) && m.to === expected.slice(2, 4);
    const move = game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
    if (!move) return;
    board.setLastMove({ from: m.from, to: m.to });
    board.render();
    if (!ok) {
      play('fail');
      setStatus('Wrong — puzzle failed.', 'lose');
      pz.won = false;
      setTimeout(() => finishProbe(false), 700);
      return;
    }
    play(move.captured ? 'capture' : 'move');
    probe.step++;
    if (probe.step >= solution.length) {
      pz.won = true;
      play('success');
      setStatus('Solved!', 'win');
      setTimeout(() => finishProbe(true), 700);
      return;
    }
    setStatus('Correct — keep going.');
    setTimeout(() => handleProbeMove(null, false), 550);
  }

  function finishProbe(solved: boolean): void {
    void solved;
    probe = null;
    const nextI = probeIndex + 1;
    if (nextI < assess.puzzles.length) {
      loadProbe(nextI);
      return;
    }
    // Probe complete → seed rating and start ladder
    const prior = priorFromPuzzles(assess.puzzles);
    assess.prior = prior;
    void (async () => {
      const { setProfileRating } = await import('../ratingOps');
      await setProfileRating(prior.rating, prior.rd);
      assess.phase = 'games';
      lastLevel = levelForRating(prior.rating);
      assess.currentLevel = lastLevel;
      toast(`Probe done — starting games from ${Math.round(prior.rating)}.`);
      void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating, color: 'w' });
    })();
  }

  function levelForRating(rating: number): number {
    let lvl = 0;
    for (let i = 0; i < ASSESSMENT_LEVELS.length; i++) {
      if (ASSESSMENT_LEVELS[i].rating <= rating) lvl = i;
    }
    return lvl;
  }

  // ---------- assessment: ladder ----------

  function onLadderGameFinished(): void {
    const result = lastResult;
    assess.games.push({ level: lastLevel, result });
    // Batched rating period: accumulate matches, recompute from the prior each time.
    assess.matches.push({
      oppRating: ASSESSMENT_LEVELS[lastLevel].rating,
      score: result === 'win' ? 1 : result === 'draw' ? 0.5 : 0,
    });
    const nextLvl = nextLevel(assess);
    lastLevel = nextLvl;
    assess.currentLevel = nextLvl;
    void (async () => {
      // Recompute the whole period from the prior (no sequential compounding).
      const { rate } = await import('../glicko2');
      const { setProfileRating } = await import('../ratingOps');
      const prior = assess.prior ?? { rating: 1500, rd: 260 };
      const batched = rate(
        { rating: prior.rating, rd: prior.rd, volatility: 0.06, lastPlayed: Date.now() },
        assess.matches.map((m) => ({ oppRating: m.oppRating, oppRd: 60, score: m.score })),
        Date.now()
      );
      // Floor at the lowest content band (600): pure math can go absurdly low
      // when every game is a resignation; the scale bottoms out here instead.
      const clamped = Math.max(600, Math.min(2900, batched.rating));
      await setProfileRating(clamped, Math.min(200, batched.rd));
      const p = await getProfile();
      if (assessmentDone(assess, p.rd)) {
        await finishAssessment();
        return;
      }
      toast(`Next: ${ASSESSMENT_LEVELS[lastLevel].label} (~${ASSESSMENT_LEVELS[lastLevel].rating}) · rating ${Math.round(p.rating)}`);
      void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
    })();
  }

  async function finishAssessment(): Promise<void> {
    const prof = await getProfile();
    assessed = true;
    prof.assessed = true;
    const { saveProfile } = await import('../db');
    await saveProfile(prof);
    mode = 'idle';
    modal(
      el('h2', {}, 'Assessment complete'),
      el('p', {}, 'Your rating: ', el('b', { class: 'rating-big' }, String(Math.round(prof.rating))),
        el('span', { class: 'rd-badge' }, `± ${Math.round(prof.rd)}`)),
      el('p', { class: 'muted' },
        'The CPU now defaults to this level. Puzzles match it too. You can re-run the assessment anytime from Settings.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'primary', onclick: () => { document.querySelector('.modal-back')?.remove(); void startGame(); } }, 'Play vs CPU'),
        el('button', { onclick: () => { document.querySelector('.modal-back')?.remove(); app.navigate('puzzles'); } }, 'Solve puzzles'))
    );
  }

  // ---------- boot ----------
  if (params.assessment) {
    void startAssessment(params.mode ?? 'probe');
  } else {
    controlsDefault();
    board.render();
  }
}