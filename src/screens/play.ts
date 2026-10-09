/** Play: CPU games + assessment (puzzle probe + staircase ladder). */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { engine } from '../engineClient';
import { ratingToStrength, ASSESSMENT_LEVELS } from '../engineStrength';
import { applyGameResult, setProfileRating } from '../ratingOps';
import { ratePeriod } from '../glicko2';
import { getProfile, getSettings, addGame, updateGame, updateProfile, getSavedAssessment, saveSavedAssessment, getLiveGame, saveLiveGame, clearLiveGame, getReview } from '../db';
import { applyBoardTheme, applyPieceSet, pieceImg } from '../pieces';
import { ChessClock, formatClock } from '../clock';
import { capturedSummary, ORDER as CAPTURED_ORDER } from '../captured';
import { detectOpening } from '../openings';
import { serializeLiveGame, deserializeLiveGame, type SavedLiveGame } from '../liveGame';
import { play } from '../sounds';
import { el, modal, toast, confirmSheet } from '../ui';
import type { App } from '../app';
import type { Color, EngineTier, GameResult, GameRecord, PuzzleItem } from '../types';
import { TIME_CONTROLS, UNTIMED, type TimeControl } from '../types';
import {
  newAssessment,
  priorFromPuzzles,
  nextLevel,
  assessmentDone,
  serializeAssessment,
  deserializeAssessment,
  LADDER_DEFAULT_PRIOR,
  type AssessmentState,
  type SavedAssessment,
} from '../assessment';
import type { AssessmentPuzzle } from '../assessment';
import { loadPuzzles } from '../puzzles';
import {
  matchesPuzzleMove,
  PUZZLE_TRY_LIMIT,
  puzzleScoreForMistakes,
  puzzleSolutionSan,
  type PuzzleScore,
} from '../puzzleScoring';
import { openReview } from './reviewView';

interface PlayParams {
  assessment?: boolean;
  mode?: 'probe' | 'ladder' | 'quick';
  rematch?: boolean;
  /** Home sent us here to resume a saved unfinished game. */
  gameLoad?: SavedLiveGame;
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
  if (!container.isConnected) return;
  applyPieceSet(settings.pieceSet);
  applyBoardTheme(settings.boardTheme);
  let activeEngineTier: EngineTier = settings.engineTier === 'full' ? 'full' : 'lite';
  let assessed = (await getProfile()).assessed;
  if (!container.isConnected) return;
  const game = new Chess();

  // ---------- state ----------
  let playerColor: Color = 'w';
  let oppRating = 1500;
  let oppTier: EngineTier = 'lite';
  let oppName = 'CPU';
  let thinking = false;
  let mode: 'idle' | 'game' | 'probe' | 'ladder' = 'idle';
  let gameType: 'none' | 'cpu' | 'passplay' = 'none';
  let ratedGame = false;
  let timeControl: TimeControl = UNTIMED;
  let clock: ChessClock | null = null;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let lastLevel = 2;
  let assess: AssessmentState = newAssessment();
  let probeGeneration = 0;
  let ladderGeneration = 0;
  let probeTimeout: ReturnType<typeof setTimeout> | undefined;
  let probe: {
    puzzle: AssessmentPuzzle;
    step: number;
    mistakes: number;
    token: number;
    complete: boolean;
    solutionShown: boolean;
  } | null = null;
  let lastResult: 'win' | 'loss' | 'draw' = 'draw';
  let gameGeneration = 0;
  let reviewGeneration = 0;
  let baseModeLabel = '';
  const dispose = () => {
    gameGeneration++;
    probeGeneration++;
    ladderGeneration++;
    reviewGeneration++;
    if (probeTimeout !== undefined) clearTimeout(probeTimeout);
    probeTimeout = undefined;
    stopClockTimer();
    engine.cancelSearch();
    document.querySelectorAll('.modal-back').forEach((modal) => modal.remove());
  };
  container.addEventListener('screen-dispose', dispose, { once: true });

  /** Save or clear the assessment snapshot between sessions. */
  function persistAssessment(state: AssessmentState | null): Promise<void> {
    return saveSavedAssessment(state ? serializeAssessment(state) : null).catch(() => {});
  }

  function persistAssessmentNow(state: AssessmentState): void {
    void persistAssessment(state);
  }

  function clearPersistedAssessment(): void {
    void saveSavedAssessment(null).catch(() => {});
  }

  /** Resume an unfinished assessment, or show why it cannot be resumed. */
  function restoreAssessment(): void {
    void getSavedAssessment()
      .then((raw) => {
        if (!container.isConnected || mode !== 'idle') return;
        if (controls.dataset.resumable === '1') return;
        const state = deserializeAssessment(raw as SavedAssessment | null);
        if (!state || state.games.length === 0 && state.puzzles.every((p) => p.won === undefined)) {
          if (state) clearPersistedAssessment();
          return;
        }
        controls.dataset.resumable = '1';
        assess = state;
        // A restored probe continues in its ladder phase; quick runs as ladder.
        mode = 'ladder';
        lastLevel = state.currentLevel;
        const gamesLabel = state.games.length === 1 ? '1 game' : `${state.games.length} games`;
        if (state.puzzles.some((p) => p.won === undefined)) {
          resumeProbeAssessment(state, gamesLabel);
          return;
        }
        resumeLadderAssessment(state, gamesLabel);
      })
      .catch(() => {});
  }

  /** Resume a probe assessment by replaying solved puzzles, then continue the run. */
  function resumeProbeAssessment(saved: AssessmentState, gamesLabel: string): void {
    const note = el('p', { class: 'tiny', style: 'margin:6px 0 0' },
      `Unfinished assessment in progress (${gamesLabel} played).`);
    const resume = () => {
      void (async () => {
        // Snapshots store puzzle ids only; reattach positions from the bundle.
        const all = await loadPuzzles().catch(() => [] as PuzzleItem[]);
        if (!container.isConnected) return;
        if (all.length === 0) {
          toast('Puzzle bundle missing — run: npm run puzzles');
          return;
        }
        const byId = new Map(all.map((item) => [item.id, item]));
        const rebuilt: AssessmentPuzzle[] = [];
        for (const puzzle of saved.puzzles) {
          const item = byId.get(puzzle.id);
          if (!item) {
            clearPersistedAssessment();
            return;
          }
          rebuilt.push({ ...item, won: puzzle.won, score: puzzle.score, mistakes: puzzle.mistakes });
        }
        clearResumableControls();
        assess = { ...saved, puzzles: rebuilt };
        mode = 'probe';
        const firstUnfinished = rebuilt.findIndex((p) => p.won === undefined);
        if (firstUnfinished === -1) {
          finishProbeToLadder();
          return;
        }
        probeIndex = firstUnfinished;
        loadProbe(firstUnfinished);
      })();
    };
    controls.append(
      note,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { class: 'primary', onclick: resume }, 'Resume assessment')),
      el('p', { class: 'tiny', style: 'margin:6px 0 0' },
        'Solved puzzles are kept; you will not repeat them.'));
  }

  /** Resume a ladder run directly into its next engine game. */
  function resumeLadderAssessment(_saved: AssessmentState, gamesLabel: string): void {
    const note = el('p', { class: 'tiny', style: 'margin:6px 0 0' },
      `Unfinished assessment in progress (${gamesLabel} played).`);
    controls.append(
      note,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { class: 'primary', onclick: () => { clearResumableControls(); resumeLadderRun(); } }, 'Resume assessment')),
      el('p', { class: 'tiny', style: 'margin:6px 0 0' },
        'Your in-run rating is kept and the ladder continues from where it left off.'));
  }

  /** Continue a restored ladder/quick run with its next engine game. */
  function resumeLadderRun(): void {
    if (!assess.prior) return;
    lastLevel = assess.currentLevel;
    mode = 'idle';
    const prior = assess.prior;
    void (async () => {
      const profile = await getProfile();
      // After a reload the stored profile already carries this run's progress.
      if (Math.round(profile.rating) !== Math.round(prior.rating)) {
        void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
        return;
      }
      await setProfileRating(prior.rating, prior.rd);
      void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
    })();
  }

  function scheduleProbe(callback: () => void, delay: number): void {
    if (probeTimeout !== undefined) clearTimeout(probeTimeout);
    probeTimeout = setTimeout(() => {
      probeTimeout = undefined;
      callback();
    }, delay);
  }

  // ---------- DOM ----------
  const boardHost = el('div', { class: 'board-wrap' });
  const opponentLabel = el('span', {}, 'CPU');
  const modeLabel = el('span', { class: 'sub' });
  const topBar = el('div', { class: 'game-top' },
    el('span', { class: 'vs' }, 'You vs ', opponentLabel),
    modeLabel);
  const statusBar = el('div', { class: 'status-bar' }, '');
  const moveList = el('div', { class: 'move-list' }, '—');
  const controls = el('div', { class: 'section play-controls' });
  const seekRow = el('div', { class: 'seek-row btn-row' },
    el('button', { onclick: () => showPly(0) }, 'Start'),
    el('button', { onclick: () => showPly((viewingPly ?? historyVerbose().length) - 1) }, 'Prev'),
    el('button', { onclick: () => showPly((viewingPly ?? historyVerbose().length - 1) + 1) }, 'Next'),
    el('button', { class: 'latest', onclick: () => showPly(null) }, 'Latest'));
  const board = new Board(boardHost, game, {
    orientation: 'w',
    interactive: false,
    autoQueen: settings.autoQueen,
    showCoords: settings.showCoords,
    markup: true,
    onMove: (m) => void onUserMove(m),
  });
  const clockBar = el('div', { class: 'clock-bar' });
  const capturedBar = el('div', { class: 'captured-bar' });
  const wrap = el('div', {},
    topBar,
    boardHost,
    capturedBar,
    clockBar,
    statusBar,
    controls
  );
  container.appendChild(wrap);
  // ---------- clocks + captured material ----------
  function stopClockTimer(): void {
    if (clockTimer !== undefined) clearInterval(clockTimer);
    clockTimer = undefined;
  }

  function startClockTimer(): void {
    stopClockTimer();
    if (!clock?.timed) return;
    clockTimer = setInterval(() => {
      renderClocks();
      persistLiveGame();
      if (clock?.flagged()) flagFall();
    }, 500);
  }

  function renderClocks(): void {
    if (!clock?.timed) {
      clockBar.style.display = 'none';
      return;
    }
    clockBar.style.display = 'flex';
    const topColor: Color = board.orientation === 'w' ? 'b' : 'w';
    const bottomColor: Color = topColor === 'w' ? 'b' : 'w';
    const label = (color: Color) =>
      gameType === 'passplay' ? (color === 'w' ? 'White' : 'Black') : color === playerColor ? 'You' : oppName;
    const cell = (color: Color) =>
      el('span', { class: `clock ${color}${game.turn() === color ? ' active' : ''}` },
        el('b', {}, label(color)), formatClock(clock!.remainingMs(color)));
    clockBar.replaceChildren(cell(topColor), cell(bottomColor));
  }

  function renderCaptured(): void {
    if (gameType === 'none') {
      capturedBar.style.display = 'none';
      return;
    }
    capturedBar.style.display = 'flex';
    const summary = capturedSummary(game);
    const topColor: Color = board.orientation === 'w' ? 'b' : 'w';
    const topCaptures = topColor === 'w' ? summary.byWhite : summary.byBlack;
    const bottomCaptures = topColor === 'w' ? summary.byBlack : summary.byWhite;
    const armyColor: Color = topColor === 'w' ? 'b' : 'w';
    const topDiff = topColor === 'w' ? summary.balance : -summary.balance;
    const row = (types: string[]) => {
      // Group repeats: one piece image + a ×N tally (♟×8 ♘×2) instead of a
      // long strip of duplicate icons.
      const counts = new Map<string, number>();
      for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
      const span = el('span', { class: 'captured-row' });
      for (const type of CAPTURED_ORDER) {
        const count = counts.get(type);
        if (!count) continue;
        span.appendChild(pieceImg(type, armyColor));
        if (count > 1) span.appendChild(el('span', { class: 'captured-count' }, `×${count}`));
      }
      return span;
    };
    capturedBar.replaceChildren(
      el('span', { class: 'captured-side' },
        row(topCaptures),
        topDiff > 0 ? el('b', {}, `+${topDiff}`) : null),
      el('span', { class: 'captured-side' },
        topDiff < 0 ? el('b', {}, `+${-topDiff}`) : null,
        row(bottomCaptures))
    );
  }

  function flagFall(): void {
    if (mode !== 'game') return;
    const flaggedColor: Color = game.turn();
    stopClockTimer();
    if (gameType === 'passplay') {
      finishPassPlay(flaggedColor === 'w' ? 'b' : 'w', 'flag fell');
      return;
    }
    finishGame('flag fell', flaggedColor === playerColor ? 'loss' : 'win');
  }

  // ---------- live-game persistence (resume) ----------
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function persistLiveGame(): void {
    if (mode !== 'game' || gameType === 'none') return;
    const snapshot: SavedLiveGame = {
      version: 1,
      type: gameType === 'passplay' ? 'passplay' : 'cpu',
      startFen: START_FEN,
      movesUci: game.history({ verbose: true }).map((h) => h.from + h.to + (h.promotion ?? '')).join(' '),
      playerColor,
      oppRating,
      oppTier: engine.tier ?? oppTier,
      rated: ratedGame,
      timeControl,
      clocksMs: clock ? { w: clock.remainingMs('w'), b: clock.remainingMs('b') } : { w: 0, b: 0 },
      ts: Date.now(),
    };
    void saveLiveGame(serializeLiveGame(snapshot)).catch(() => {});
  }

  /** Rebuild an interrupted game from its snapshot (Home or a gameLoad param). */
  function resumeSavedGame(saved: SavedLiveGame): void {
    const generation = ++gameGeneration;
    gameType = saved.type;
    ratedGame = saved.rated;
    timeControl = saved.timeControl;
    playerColor = saved.playerColor;
    oppRating = saved.oppRating;
    oppTier = saved.oppTier;
    oppName = saved.type === 'passplay' ? 'Pass & play' : `CPU ${saved.oppRating}`;
    opponentLabel.textContent = saved.type === 'passplay' ? 'White vs Black' : oppName;
    baseModeLabel = saved.type === 'passplay'
      ? ' · pass-and-play · resumed'
      : ` · ${saved.rated ? 'rated' : 'casual'} · resumed`;
    refreshOpeningLabel();
    mode = 'game';
    // Replay into the live game (not load of the end FEN) so history, the
    // move list, seeking, and the final movesUci all stay intact.
    game.load(saved.startFen);
    let lastMove: { from: string; to: string } | null = null;
    for (const uci of saved.movesUci.split(/\s+/).filter(Boolean)) {
      try {
        const applied = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        lastMove = { from: applied.from, to: applied.to };
      } catch {
        break;
      }
    }
    clock = new ChessClock(saved.timeControl, game.turn(), () => performance.now(), saved.clocksMs);
    board.setOrientation(saved.type === 'passplay' ? game.turn() : playerColor);
    board.setLastMove(lastMove);
    board.setInteractive(false);
    board.deselect();
    viewingPly = null;
    renderMoves();
    controlsInGame(saved.type === 'cpu' && !settings.strictMode);
    renderCaptured();
    renderClocks();
    setStatus('Resuming — loading engine…');
    void (async () => {
      try {
        await ensureEngine((s) => {
          if (generation === gameGeneration && container.isConnected) setStatus(s);
        });
      } catch (error) {
        if (generation === gameGeneration && container.isConnected) {
          setStatus(`Engine failed to load: ${(error as Error).message}`, 'lose');
        }
        return;
      }
      if (generation !== gameGeneration || !container.isConnected || mode !== 'game') return;
      const myTurn = gameType === 'passplay' || game.turn() === playerColor;
      board.setInteractive(myTurn && !game.isGameOver());
      if (myTurn) {
        setStatus(gameType === 'passplay'
          ? (game.turn() === 'w' ? 'White to move.' : 'Black to move.')
          : 'Your move');
      } else {
        setStatus(`${oppName} is thinking…`);
        void engineMove();
      }
      startClockTimer();
      renderClocks();
    })();
  }

  /** Offer to resume/discard a saved unfinished game below the idle controls. */
  function restoreSavedGameInIdle(): void {
    void getLiveGame()
      .then((raw) => {
        if (!container.isConnected || mode !== 'idle' || controls.dataset.resumable === '1') return;
        if (controls.dataset.liveResumable === '1') return;
        const saved = deserializeLiveGame(raw);
        if (!saved) return;
        controls.dataset.liveResumable = '1';
        const moveCount = saved.movesUci.split(/\s+/).filter(Boolean).length;
        const savedWhen = new Date(saved.ts);
        controls.append(
          el('p', { class: 'kicker' }, 'Unfinished game'),
          el('div', { class: 'btn-row' },
            el('button', { class: 'primary', onclick: () => {
              delete controls.dataset.liveResumable;
              resumeSavedGame(saved);
            } },
              saved.type === 'passplay' ? 'Resume pass-and-play' : `Resume vs CPU ${saved.oppRating}`),
            el('button', { onclick: () => {
              delete controls.dataset.liveResumable;
              void clearLiveGame().catch(() => {});
              controlsDefault();
            } }, 'Discard')),
          el('p', { class: 'tiny', style: 'margin:6px 0 0' },
            `${moveCount} ${moveCount === 1 ? 'move' : 'moves'} played · saved ${savedWhen.toLocaleDateString()} ${savedWhen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
      })
      .catch(() => {});
  }

  // ---------- game setup ----------
  function showGameSetup(): void {
    const tcSelect = el('select', {},
      ...TIME_CONTROLS.map((entry) => el('option', { value: entry.id }, entry.label))) as HTMLSelectElement;
    const colorSelect = el('select', {},
      el('option', { value: 'random' }, 'Random'),
      el('option', { value: 'w' }, 'White'),
      el('option', { value: 'b' }, 'Black')) as HTMLSelectElement;
    const closeSheet = modal(
      el('h2', {}, 'New game'),
      el('div', { class: 'row' }, el('span', {}, 'Time control'), tcSelect),
      el('div', { class: 'row' }, el('span', {}, 'Your color'), colorSelect),
      el('p', { class: 'tiny' }, assessed
        ? 'Games of 10+0 or slower are rated.'
        : 'Casual until you establish a rating. Finish an assessment to make games rated.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'primary', onclick: () => {
          const entry = TIME_CONTROLS.find((tc) => tc.id === tcSelect.value) ?? TIME_CONTROLS[0];
          const color = colorSelect.value === 'random' ? undefined : (colorSelect.value as Color);
          closeSheet();
          void startGame({ color, timeControl: entry.tc });
        } }, 'Play the CPU'),
        el('button', { onclick: () => {
          const entry = TIME_CONTROLS.find((tc) => tc.id === tcSelect.value) ?? TIME_CONTROLS[0];
          closeSheet();
          void startPassPlay(entry.tc);
        } }, 'Two players')),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => closeSheet() }, 'Cancel'))
    );
  }

  /** Two humans, one device. */
  async function startPassPlay(tc: TimeControl): Promise<void> {
    const generation = ++gameGeneration;
    gameType = 'passplay';
    ratedGame = false;
    timeControl = tc;
    oppRating = 0;
    oppTier = 'lite';
    oppName = 'Pass & play';
    playerColor = 'w';
    mode = 'game';
    opponentLabel.textContent = 'White vs Black';
    baseModeLabel = ` · pass-and-play${tc.base > 0 ? ` · ${Math.round(tc.base / 60)}+${tc.inc}` : ''}`;
    refreshOpeningLabel();
    clock = new ChessClock(tc, 'w');
    game.load(START_FEN);
    board.setOrientation('w');
    board.setLastMove(null);
    board.clearMarkup();
    board.setInteractive(true);
    board.deselect();
    viewingPly = null;
    renderMoves();
    controlsInGame(false);
    setStatus('White to move.');
    renderCaptured();
    renderClocks();
    persistLiveGame();
    startClockTimer();
    void generation;
  }

  /** End a pass-and-play game: one record per side, no rating effects. */
  function finishPassPlay(winner: Color, termination: string): void {
    stopClockTimer();
    board.setInteractive(false);
    board.clearPreview();
    viewingPly = null;
    showSeekRow(false);
    gameGeneration++;
    thinking = false;
    mode = 'idle';
    void clearLiveGame().catch(() => {});
    const movesUci = game.history({ verbose: true }).map((h) => h.from + h.to + (h.promotion ?? '')).join(' ');
    const loser: Color = winner === 'w' ? 'b' : 'w';
    const winnerName = winner === 'w' ? 'White wins' : 'Black wins';
    setStatus(`${winnerName} (${termination}).`, 'win');
    play('gameEnd');
    const rec: GameRecord = {
      ts: Date.now(),
      type: 'passplay',
      color: winner,
      result: 'win',
      movesUci,
      startFen: START_FEN,
      opponentRating: 0,
      opponentTier: 'lite',
      rated: false,
      termination,
    };
    const loserRec: GameRecord = { ...rec, color: loser, result: 'loss' };
    void (async () => {
      try {
        await addGame(rec);
        await addGame(loserRec);
      } catch (error) {
        if (container.isConnected) toast(`Could not save game: ${(error as Error).message}`);
      }
    })();
    const closeSheet = modal(
      el('h2', {}, winnerName),
      el('p', { class: 'muted' }, `${termination} · ${game.history().length} plies`),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => { closeSheet(); doReview(rec); } }, 'Review game'),
        el('button', { class: 'primary', onclick: () => { closeSheet(); void startPassPlay(timeControl); } }, 'Play again'),
        el('button', { onclick: () => { closeSheet(); controlsDefault(); } }, 'Done'))
    );
  }

  function setStatus(s: string, cls = ''): void {
    statusBar.textContent = s;
    statusBar.className = `status-bar ${cls}`;
  }

  // ---------- position seeking ----------
  let viewingPly: number | null = null; // ply index (1-based) shown on the board

  const historyVerbose = () => game.history({ verbose: true });

  function fenAtPly(ply: number): string {
    if (ply >= historyVerbose().length) return game.fen();
    const replay = new Chess();
    for (const move of historyVerbose().slice(0, ply)) {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
    return replay.fen();
  }

  function showPly(ply: number | null): void {
    const history = historyVerbose();
    const live = ply === null || ply >= history.length;
    document.body.classList.toggle('viewing', !live);
    if (live) {
      viewingPly = null;
      board.clearPreview();
      renderMoves();
      showSeekRow(false);
      if (mode === 'game' || mode === 'ladder') {
        if (!game.isGameOver()) setStatus(game.turn() === playerColor ? 'Your move' : `${oppName} is thinking…`);
      }
      return;
    }
    const clamped = Math.max(0, ply);
    const move = clamped === 0 ? null : history[clamped - 1];
    board.showPosition(fenAtPly(clamped), move ? { from: move.from, to: move.to } : null);
    viewingPly = clamped;
    renderMoves();
    showSeekRow(true);
    setStatus(clamped === 0
      ? 'Viewing the start position. Tap Latest to return.'
      : `Viewing move ${clamped} of ${history.length}. Tap Latest to return.`);
  }

  function isViewing(): boolean {
    return viewingPly !== null;
  }

  function showSeekRow(visible: boolean): void {
    if (!seekRow) return;
    seekRow.style.display = visible ? '' : 'none';
  }

  function renderMoves(): void {
    const hist = historyVerbose();
    if (hist.length === 0) {
      moveList.textContent = '—';
      return;
    }
    moveList.textContent = '';
    for (let i = 0; i < hist.length; i += 2) {
      const plyIndex = i / 2 + 1;
      moveList.append(
        el('button', {
          class: `ply${viewingPly !== null && plyIndex <= viewingPly ? ' current' : ''}`,
          onclick: () => showPly(plyIndex === hist.length ? null : plyIndex),
        },
          el('span', { class: 'num' }, `${plyIndex}.`),
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
          el('button', { class: 'primary', onclick: () => showGameSetup() }, 'New game vs CPU')),
      el('p', { class: 'tiny', style: 'margin:6px 0 0' },
        'Rated · CPU strength follows your rating'),
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('span', { class: 'muted' }, 'Moves'), el('span', {}, '')),
        moveList
      );
      controlsResumable();
      restoreSavedGameInIdle();
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
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => showGameSetup() }, 'Casual game vs CPU')),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'You can re-run any assessment later from Settings.'),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('span', { class: 'muted' }, 'Moves'), el('span', {}, '')),
      moveList
    );
    controlsResumable();
    restoreSavedGameInIdle();
  }

  function controlsInGame(allowHelpers: boolean): void {
    controls.textContent = '';
    const isPassPlay = gameType === 'passplay';
    controls.append(
      moveList,
      seekRow,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { onclick: () => {
          board.setOrientation(board.orientation === 'w' ? 'b' : 'w');
          renderCaptured();
          renderClocks();
        } }, 'Flip board'),
        isPassPlay
          ? el('button', { onclick: () => {
              void (async () => {
                const ok = await confirmSheet({
                  title: 'Resign as Black?',
                  message: 'White wins by resignation.',
                  confirmLabel: 'Resign',
                  danger: true,
                });
                if (ok && container.isConnected) finishPassPlay('w', 'resignation');
              })();
            } }, 'Resign as Black')
          : el('button', { onclick: () => void resign() }, 'Resign'),
        allowHelpers ? el('button', { onclick: () => void hint() }, 'Hint') : null,
        allowHelpers ? el('button', { onclick: () => takeback() }, 'Takeback') : null)
    );
  }

  function controlsProbe(): void {
    controls.textContent = '';
    controls.append(
      moveList,
      el('div', { class: 'btn-row', style: 'margin-top:8px' },
        el('button', { onclick: () => skipProbe() }, 'Show solution')),
      el('p', { class: 'muted', style: 'margin:6px 0 0' },
        `Find the best move. You have ${PUZZLE_TRY_LIMIT} tries; each miss lowers the assessment credit.`)
    );
  }

  function controlsProbeResult(): void {
    controls.textContent = '';
    const activeProbe = probe;
    const actions = el('div', { class: 'btn-row', style: 'margin-top:8px' });
    if (activeProbe?.complete && (activeProbe.puzzle.score ?? 0) > 0) {
      actions.append(el('button', { class: 'primary', onclick: () => finishProbe() },
        probeIndex + 1 < assess.puzzles.length ? 'Next puzzle' : 'Start games'));
    } else if (activeProbe && !activeProbe.solutionShown) {
      actions.append(el('button', { class: 'probe-solution-action', onclick: () => displayProbeSolution(activeProbe) }, 'Show solution'));
    } else if (activeProbe?.complete) {
      actions.append(el('button', { class: 'primary', onclick: () => finishProbe() },
        probeIndex + 1 < assess.puzzles.length ? 'Next puzzle' : 'Start games'));
    }
    controls.append(moveList, actions);
    if (activeProbe?.complete && (activeProbe.puzzle.score ?? 0) === 0 && !activeProbe.solutionShown) {
      controls.append(el('p', { class: 'tiny' }, 'View the solution to continue.'));
    }
  }

  function displayProbeSolution(activeProbe: NonNullable<typeof probe>): void {
    activeProbe.solutionShown = true;
    setStatus(`Solution: ${puzzleSolutionSan(activeProbe.puzzle.fen, activeProbe.puzzle.moves)}`);
    controls.querySelector('.probe-solution-action')?.remove();
    if (activeProbe.complete) controlsProbeResult();
  }

  function completeProbe(activeProbe: NonNullable<typeof probe>, score: PuzzleScore): void {
    if (activeProbe.complete) return;
    activeProbe.complete = true;
    activeProbe.puzzle.score = score;
    activeProbe.puzzle.mistakes = activeProbe.mistakes;
    activeProbe.puzzle.won = score > 0;
    persistAssessmentNow(assess);
    board.setInteractive(false);
    if (score === 0) {
      setStatus(activeProbe.solutionShown ? `Solution: ${puzzleSolutionSan(activeProbe.puzzle.fen, activeProbe.puzzle.moves)}` : 'Three tries used — no credit.', 'lose');
      controlsProbeResult();
    } else {
      setStatus(activeProbe.mistakes === 0 ? 'Solved!' : `Solved — ${Math.round(score * 100)}% credit.`, 'win');
      controlsProbeResult();
    }
  }

  function skipProbe(): void {
    if (mode !== 'probe' || !probe) return;
    if (probe.complete) displayProbeSolution(probe);
    else revealProbeSolution(probe);
  }

  function revealProbeSolution(activeProbe: NonNullable<typeof probe>): void {
    activeProbe.token++;
    activeProbe.puzzle.score = 0;
    activeProbe.puzzle.mistakes = activeProbe.mistakes;
    activeProbe.puzzle.won = false;
    activeProbe.complete = true;
    activeProbe.solutionShown = false;
    persistAssessmentNow(assess);

    board.setInteractive(false);
    displayProbeSolution(activeProbe);
  }

  // ---------- engine helpers ----------
  async function ensureEngine(onStatus: (s: string) => void): Promise<void> {
    try {
      await engine.init(activeEngineTier, (phase, frac) => {
        if (phase === 'download') onStatus(`Downloading engine ${Math.round(frac * 100)}%`);
        else onStatus('Booting engine…');
      });
    } catch (error) {
      if (activeEngineTier !== 'full') throw error;
      onStatus('Full engine unavailable — switching to lite…');
      await engine.init('lite');
      activeEngineTier = 'lite';
      // Session-scoped fallback only. Writing 'lite' to the saved settings here
      // is what silently uninstalled the full engine for good: one dropped
      // 40MB boot (phone network, evicted cache, tab closed mid-boot) and the
      // app behaved as if it had never been downloaded. The preference is left
      // untouched so the next game tries the full engine again.
      toast('Full engine unavailable — using lite this game.');
    }
  }

  // ---------- game flow ----------
  async function startGame(opts?: { color?: Color; rating?: number; ladder?: boolean; timeControl?: TimeControl }): Promise<void> {
    const generation = ++gameGeneration;
    let p;
    try {
      p = await getProfile();
    } catch (error) {
      if (generation === gameGeneration && container.isConnected) {
        setStatus(`Could not load your profile: ${(error as Error).message}`, 'lose');
      }
      return;
    }
    if (generation !== gameGeneration || !container.isConnected) return;
    oppRating = Math.round(opts?.rating ?? settings.lastOpponentRating ?? p.rating);
    oppTier = activeEngineTier;
    playerColor = opts?.color ?? (Math.random() < 0.5 ? 'w' : 'b');
    oppName = opts?.ladder
      ? `Stockfish ${ASSESSMENT_LEVELS[lastLevel].label} (~${ASSESSMENT_LEVELS[lastLevel].rating})`
      : `CPU ${oppRating}`;
    opponentLabel.textContent = oppName;
    gameType = opts?.ladder ? 'none' : 'cpu';
    ratedGame = !opts?.ladder && assessed;
    timeControl = opts?.timeControl ?? UNTIMED;
    baseModeLabel = opts?.ladder
      ? ' · assessment'
      : `${assessed ? ' · rated' : ' · casual'}${timeControl.base > 0 ? ` · ${Math.round(timeControl.base / 60)}+${timeControl.inc}` : ''}`;
    refreshOpeningLabel();
    mode = opts?.ladder ? 'ladder' : 'game';

    game.load(START_FEN);
    clock = new ChessClock(timeControl, 'w');
    board.setOrientation(playerColor);
    board.setLastMove(null);
    board.clearMarkup();
    board.setInteractive(false);
    board.deselect();
    viewingPly = null;
    renderMoves();
    controlsInGame(!opts?.ladder && !settings.strictMode);
    renderCaptured();
    renderClocks();
    setStatus('Loading engine…');
    try {
      await ensureEngine((s) => {
        if (generation === gameGeneration && container.isConnected) setStatus(s);
      });
    } catch (e) {
      if (generation === gameGeneration && container.isConnected) setStatus(`Engine failed to load: ${(e as Error).message}`, 'lose');
      return;
    }
    if (generation !== gameGeneration || !container.isConnected || (mode !== 'game' && mode !== 'ladder')) return;
    setStatus(playerColor === 'w' ? 'Your move — you play White' : `You play Black. ${oppName} starts…`);
    board.setInteractive(game.turn() === playerColor);
    startClockTimer();
    renderClocks();
    if (game.turn() !== playerColor) void engineMove();
    persistLiveGame();
  }

  async function engineMove(): Promise<void> {
    // Engine plays in casual/rated CPU games AND assessment ladder games (mode ladder).
    if (thinking || !container.isConnected || (mode !== 'ladder' && gameType !== 'cpu') || (mode !== 'game' && mode !== 'ladder') || game.isGameOver()) return;

    const generation = gameGeneration;
    thinking = true;
    board.setInteractive(false);
    setStatus(`${oppName} is thinking…`);
    const strength = ratingToStrength(oppRating, activeEngineTier);
    try {
      const fen = game.fen();
      const mv = await engine.play(fen, strength);
      if (generation !== gameGeneration || !container.isConnected) return;
      if (game.fen() !== fen) throw new Error('Position changed while the engine was thinking');
      thinking = false;
      if (mode !== 'game' && mode !== 'ladder') return;
      if (game.turn() === playerColor) return;
      if (!applyMove(mv, false)) throw new Error('Engine returned an illegal move');
    } catch (e) {
      if (generation !== gameGeneration || !container.isConnected) return;
      thinking = false;
      board.setInteractive(game.turn() === playerColor && (mode === 'game' || mode === 'ladder'));
      setStatus(`Engine error: ${(e as Error).message}`, 'lose');
    }
  }

  function applyMove(mv: { from: string; to: string; promotion?: string }, byPlayer: boolean): boolean {
    const move = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
    if (!move) return false;
    clock?.movePlayed();
    board.setLastMove({ from: mv.from, to: mv.to });
    if (isViewing()) {
      viewingPly = null;
      document.body.classList.remove('viewing');
      showSeekRow(false);
    }
    board.render();
    renderMoves();
    renderCaptured();
    refreshOpeningLabel();
    play(move.captured ? 'capture' : 'move');
    if (game.isGameOver()) {
      if (gameType === 'passplay') {
        if (game.isCheckmate()) finishPassPlay(game.turn() === 'w' ? 'b' : 'w', 'checkmate');
        else finishPassPlayDraw(game.isStalemate() ? 'stalemate' : 'draw');
      } else {
        finishGame();
      }
      return true;
    }
    if (game.inCheck()) play('check');
    if (gameType === 'passplay') {
      board.setInteractive(!game.isGameOver());
      setStatus(game.turn() === 'w' ? 'White to move.' : 'Black to move.');
      renderClocks();
      persistLiveGame();
    } else if (mode === 'game' || mode === 'ladder') {
      const myTurn = game.turn() === playerColor;
      board.setInteractive(myTurn && !thinking);
      setStatus(myTurn ? 'Your move' : `${oppName} is thinking…`);
      renderClocks();
      persistLiveGame();
      if (!myTurn) void engineMove();
    } else if (mode === 'probe') {
      void handleProbeMove(null, byPlayer);
    }
    return true;
  }

  async function onUserMove(m: { from: string; to: string; promotion?: string }): Promise<void> {
    if (thinking || (mode === 'probe' && probe?.complete)) return;
    if (mode === 'probe') {
      await handleProbeMove(m, true);
      return;
    }
    if (mode !== 'game' && mode !== 'ladder') return;
    if (gameType === 'passplay') {
      if (!applyMove(m, true)) return;
      return;
    }
    if (game.turn() !== playerColor) return;
    if (!applyMove(m, true)) return;
  }

  /** Stalemate/draw in pass-and-play: one drawn record for each side. */
  function finishPassPlayDraw(termination: string): void {
    stopClockTimer();
    board.setInteractive(false);
    board.clearPreview();
    viewingPly = null;
    showSeekRow(false);
    gameGeneration++;
    thinking = false;
    mode = 'idle';
    void clearLiveGame().catch(() => {});
    const movesUci = game.history({ verbose: true }).map((h) => h.from + h.to + (h.promotion ?? '')).join(' ');
    const rec: GameRecord = {
      ts: Date.now(),
      type: 'passplay',
      color: 'w',
      result: 'draw',
      movesUci,
      startFen: START_FEN,
      opponentRating: 0,
      opponentTier: 'lite',
      rated: false,
      termination,
    };
    setStatus(`Draw (${termination}).`);
    play('gameEnd');
    void addGame(rec).catch(() => {});
    void addGame({ ...rec, color: 'b' }).catch(() => {});
    const closeSheet = modal(
      el('h2', {}, 'Draw'),
      el('p', { class: 'muted' }, `${termination} · ${game.history().length} plies`),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => { closeSheet(); doReview(rec); } }, 'Review game'),
        el('button', { class: 'primary', onclick: () => { closeSheet(); void startPassPlay(timeControl); } }, 'Play again'),
        el('button', { onclick: () => { closeSheet(); controlsDefault(); } }, 'Done'))
    );
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
    board.clearPreview();
    viewingPly = null;
    showSeekRow(false);
    engine.cancelSearch();
    stopClockTimer();
    const wasLadder = mode === 'ladder';
    const wasPassPlay = gameType === 'passplay';
    if (!wasLadder) void clearLiveGame().catch(() => {});
    gameGeneration++;
    thinking = false;
    mode = 'idle';
    lastResult = r.result === 'abandoned' ? 'draw' : r.result;
    const endedPlyCount = game.history().length;
    const endedOpponentName = oppName;
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
      type: wasLadder ? 'assessment' : wasPassPlay ? 'passplay' : 'cpu',
      color: playerColor,
      result: r.result,
      movesUci,
      startFen: START_FEN,
      opponentRating: oppRating,
      opponentTier: wasPassPlay ? 'lite' : (engine.tier ?? activeEngineTier),
      rated: assessed && !wasLadder && !wasPassPlay,
      termination: r.termination,
    };
    const wasAssessed = assessed;
    const finishedGameGeneration = gameGeneration;
    void (async () => {
      try {
        rec.id = await addGame(rec);
      } catch (error) {
        if (container.isConnected) toast(`Could not save game: ${(error as Error).message}`);
        if (finishedGameGeneration === gameGeneration && container.isConnected) setStatus('Game finished, but saving failed.', 'lose');
        return;
      }
      if (finishedGameGeneration !== gameGeneration || !container.isConnected) return;
      if (wasLadder) {
        // Ladder games are batched into one rating period in onLadderGameFinished().
      } else if (wasAssessed) {
        try {
          const { before, after } = await applyGameResult({
            oppRating,
            result: r.result,
            kind: 'game',
          });
          rec.ratingBefore = before;
          rec.ratingAfter = after;
          await updateGame(rec);
          if (container.isConnected) toast(`Rating: ${Math.round(before)} → ${Math.round(after)}`);
        } catch (error) {
          if (container.isConnected) toast(`Game saved, but rating update failed: ${(error as Error).message}`);
        }
      }
      if (finishedGameGeneration === gameGeneration && container.isConnected) {
        void showPostGame(rec, endedOpponentName, endedPlyCount);
      }
    })();
  }

  interface ReviewPlayerSummary {
    worst?: { ply: number; san: string; bestSan?: string };
  }

  /** Worst-move teaser from an existing analysis, if this game was reviewed before. */
  async function reviewPrompt(rec: GameRecord): Promise<string> {
    try {
      const review = await getReview(rec.ts) as { players?: Record<string, ReviewPlayerSummary> } | null;
      const worst = review?.players?.[rec.color === 'w' ? 'white' : 'black']?.worst;
      if (!worst?.bestSan) return '';
      return ` (${Math.ceil(worst.ply / 2)}${worst.ply % 2 ? '.' : '…'} ${worst.san} → ${worst.bestSan})`;
    } catch {
      return '';
    }
  }

  async function showPostGame(rec: GameRecord, opponentNameAtEnd: string, plyCount: number): Promise<void> {
    const ratingLine = rec.ratingAfter
      ? el('p', { class: 'muted' },
          `Rating ${Math.round(rec.ratingBefore ?? 0)} → `, el('b', {}, String(Math.round(rec.ratingAfter))))
      : undefined;
    // Ladder advances FIRST (renders next game), then the result sheet overlays it.
    if (rec.type === 'assessment') setTimeout(() => onLadderGameFinished(), 0);
    const teaser = rec.type === 'assessment' ? '' : await reviewPrompt(rec);
    const reviewBtn = el('button', { onclick: () => doReview(rec) },
      teaser ? `Review blunders${teaser}` : 'Review game');
    const closeSheet = modal(
      el('h2', {}, rec.result === 'win' ? 'Victory' : rec.result === 'loss' ? 'Defeat' : 'Draw'),
      ...(ratingLine ? [ratingLine as Node] : []),
      el('p', { class: 'muted' }, `vs ${opponentNameAtEnd} · ${rec.termination} · ${plyCount} plies`),
      el('div', { class: 'btn-row' },
        reviewBtn,
        rec.type === 'assessment'
          ? el('button', { onclick: () => closeSheet() }, 'Continue')
          : el('button', { onclick: () => { closeSheet(); void startGame(); } }, 'Play again'),
        el('button', { onclick: () => {
          closeSheet();
          if (rec.type !== 'assessment') controlsDefault();
        } }, 'Done'))
    );
  }

  function doReview(rec: GameRecord): void {
    const generation = ++reviewGeneration;
    engine.cancelSearch();
    void openReview(rec, () => generation === reviewGeneration && container.isConnected);
  }

  // ---------- helpers ----------
  async function hint(): Promise<void> {
    if (thinking || isViewing() || game.turn() !== playerColor) return;
    const generation = gameGeneration;
    const position = game.fen();
    thinking = true;
    board.setInteractive(false);
    setStatus('Thinking…');
    try {
      const mv = await engine.analyse(position, 600, () => {});
      if (generation !== gameGeneration || !container.isConnected || game.fen() !== position) return;
      if (!mv) throw new Error('no move');
      setStatus(`Hint: consider ${sanOf(mv)}`);
    } catch {
      if (generation === gameGeneration && container.isConnected) setStatus('Hint unavailable.');
    } finally {
      if (generation === gameGeneration && container.isConnected) {
        thinking = false;
        if ((mode === 'game' || mode === 'ladder') && game.turn() === playerColor) board.setInteractive(true);
      }
    }
  }

  function takeback(): void {
    if (thinking || isViewing() || game.history().length === 0) return;
    engine.cancelSearch();
    if (game.turn() === playerColor && game.history().length >= 2) game.undo();
    game.undo();
    board.setLastMove(null);
    board.render();
    renderMoves();
    board.setInteractive(true);
    setStatus('Takeback — your move.');
  }

  /** Rated and ladder games count resignation as a loss, so ask first. */
  async function resign(): Promise<void> {
    const canResign = (): boolean => gameType !== 'passplay' && (mode === 'game' || mode === 'ladder');
    if (!canResign()) return;
    const ok = await confirmSheet({
      title: 'Resign this game?',
      message: 'Resigning counts as a loss.',
      confirmLabel: 'Resign',
      danger: true,
    });
    // The game may have ended while the sheet was open.
    if (!ok || !container.isConnected || !canResign()) return;
    finishGame('resignation', 'loss');
  }

  /** Keep the opening name in the sub-label once moves exist. */
  function refreshOpeningLabel(): void {
    const opening = gameType === 'none' ? null : detectOpening(historyVerbose());
    modeLabel.textContent = baseModeLabel + (opening ? ` · ${opening.name}` : '');
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
    if (container.isConnected && controls.dataset.resumable === '1') {
      const proceed = await confirmSheet({
        title: 'Start a new assessment?',
        message: 'The unfinished one will be discarded.',
        confirmLabel: 'Start new',
        danger: true,
      });
      if (!proceed) return;
    }
    const generation = ++probeGeneration;
    ladderGeneration++;
    assess = newAssessment(chosenMode);
    clearPersistedAssessment();
    if (chosenMode !== 'probe') mode = 'idle';
    if (chosenMode === 'probe') {
      mode = 'probe';
      const all = await loadPuzzles().catch(() => [] as PuzzleItem[]);
      if (generation !== probeGeneration || !container.isConnected) return;
      if (all.length === 0) {
        toast('Puzzle bundle missing — run: npm run puzzles');
        return;
      }
      // Probe: 8 puzzles around 1200–1800 to bracket the prior.
      const band = all.filter((p) => p.rating >= 1100 && p.rating <= 1900);
      assess.puzzles = shuffle(band.length >= 8 ? band : all)
        .slice(0, 8)
        .map((puzzle) => ({ ...puzzle }));
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
    persistAssessmentNow(assess);
    await setProfileRating(prior.rating, prior.rd);
    if (generation !== probeGeneration || !container.isConnected) return;
    lastLevel = levelForRating(prior.rating);
    assess.currentLevel = lastLevel;
    mode = 'idle';
    toast(chosenMode === 'quick' ? 'Quick scan — 6 games.' : 'Ladder — from level 3 (~1200).');
    void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
  }

  let probeIndex = 0;

  function controlsResumable(): void {
    void getSavedAssessment()
      .then((raw) => {
        if (!container.isConnected || mode !== 'idle' || controls.dataset.resumable === '1') return;
        const state = deserializeAssessment(raw as SavedAssessment | null);
        if (!state) return;
        if (state.games.length === 0 && state.puzzles.every((p) => p.won === undefined)) {
          clearPersistedAssessment();
          return;
        }
        controls.dataset.resumable = '1';
        const gamesLabel = state.games.length === 1 ? '1 game' : `${state.games.length} games`;
        if (state.puzzles.some((p) => p.won === undefined)) {
          resumeProbeAssessment(state, gamesLabel);
        } else {
          resumeLadderAssessment(state, gamesLabel);
        }
      })
      .catch(() => {});
  }

  function clearResumableControls(): void {
    delete controls.dataset.resumable;
  }

  function loadProbe(i: number): void {
    probeIndex = i;
    controlsProbe();
    const pz = assess.puzzles[i];
    probe = { puzzle: pz, step: 0, mistakes: 0, token: 0, complete: false, solutionShown: false };
    pz.score = undefined;
    pz.mistakes = undefined;
    pz.won = undefined;

    // Lichess FEN is before the opponent's pre-move; play it to reach the solve position.
    const g = new Chess(pz.fen);
    const oppMove = pz.moves[0];
    g.move({ from: oppMove.slice(0, 2), to: oppMove.slice(2, 4), promotion: oppMove[4] });
    game.load(g.fen());
    // The solver plays the side that is to move AFTER the pre-move.
    playerColor = g.turn();
    board.setOrientation(playerColor);
    if (isViewing()) {
      viewingPly = null;
      document.body.classList.remove('viewing');
      showSeekRow(false);
    }
    board.setLastMove({ from: oppMove.slice(0, 2), to: oppMove.slice(2, 4) });
    board.setInteractive(true);
    board.render();
    setStatus('Solve: find the best move.');
    controlsProbe();
    moveList.textContent = `Puzzle ${i + 1} of ${assess.puzzles.length}`;
    modeLabel.textContent = ` · puzzle probe ${i + 1}/${assess.puzzles.length}`;
  }

  async function handleProbeMove(m: { from: string; to: string; promotion?: string } | null, byPlayer: boolean): Promise<void> {
    if (!probe || probe.complete) return;
    const activeProbe = probe;
    const pz = activeProbe.puzzle;
    const solution = pz.moves.slice(1); // after opponent's opening move
    const step = activeProbe.step;

    if (!byPlayer) {
      // Engine's scripted reply
      const reply = solution[step];
      if (!reply) {
        completeProbe(activeProbe, puzzleScoreForMistakes(activeProbe.mistakes));
        return;
      }
      const mv = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      if (!mv) {
        completeProbe(activeProbe, puzzleScoreForMistakes(activeProbe.mistakes));
        return;
      }
      board.setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      board.render();
      activeProbe.step++;
      if (activeProbe.step >= solution.length) {
        completeProbe(activeProbe, puzzleScoreForMistakes(activeProbe.mistakes));
      } else {
        setStatus('Your move.');
        const token = ++activeProbe.token;
        board.setInteractive(false);
        scheduleProbe(() => {
          if (probe !== activeProbe || activeProbe.complete || activeProbe.token !== token) return;
          board.setInteractive(true);
        }, 450);
      }
      return;
    }

    if (!m) return;
    const expected = solution[step];
    const ok = matchesPuzzleMove(m, expected);
    if (!ok) {
      activeProbe.mistakes++;
      play('fail');
      if (activeProbe.mistakes >= PUZZLE_TRY_LIMIT) {
        completeProbe(activeProbe, 0);
      } else {
        const score = Math.round(puzzleScoreForMistakes(activeProbe.mistakes) * 100);
        setStatus(`Not quite — ${score}% credit if solved; ${PUZZLE_TRY_LIMIT - activeProbe.mistakes} ${PUZZLE_TRY_LIMIT - activeProbe.mistakes === 1 ? 'try' : 'tries'} left.`, 'lose');
        controlsProbe();
      }
      return;
    }

    const move = game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
    if (!move) return;
    board.setLastMove({ from: m.from, to: m.to });
    board.render();
    play(move.captured ? 'capture' : 'move');
    activeProbe.step++;
    if (activeProbe.step >= solution.length) {
      play('success');
      completeProbe(activeProbe, puzzleScoreForMistakes(activeProbe.mistakes));
      return;
    }
    const token = ++activeProbe.token;
    setStatus('Correct — keep going.');
    board.setInteractive(false);
    scheduleProbe(() => {
      if (probe !== activeProbe || activeProbe.complete || activeProbe.token !== token) return;
      void handleProbeMove(null, false);
    }, 550);
  }

  function finishProbe(): void {
    if (!probe?.complete || (!probe.solutionShown && (probe.puzzle.score ?? 0) <= 0)) return;
    probe = null;
    const nextI = probeIndex + 1;
    if (nextI < assess.puzzles.length) {
      loadProbe(nextI);
      return;
    }
    finishProbeToLadder();
  }

  /** Probe finished: seed the rating from puzzle results and start the ladder. */
  function finishProbeToLadder(): void {
    const prior = priorFromPuzzles(assess.puzzles);
    assess.prior = prior;
    lastLevel = levelForRating(prior.rating);
    assess.currentLevel = lastLevel;
    persistAssessmentNow(assess);
    const generation = ++probeGeneration;
    void (async () => {
      await setProfileRating(prior.rating, prior.rd);
      if (generation !== probeGeneration || !container.isConnected) return;
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
    if (!container.isConnected) return;
    const generation = ++ladderGeneration;
    if (assess.games.length >= (assess.mode === 'quick' ? 6 : assess.mode === 'ladder' ? 14 : 12)) return;
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
      const prior = assess.prior ?? { rating: 1500, rd: 260 };
      const matches = assess.matches.map((match) => ({ ...match, oppRd: 60 }));
      const batched = ratePeriod(
        { rating: prior.rating, rd: prior.rd, volatility: 0.06, lastPlayed: Date.now() },
        matches,
        Date.now()
      );
      // Floor at the lowest content band (600): pure math can go absurdly low
      // when every game is a resignation; the scale bottoms out here instead.
      const clamped = Math.max(600, Math.min(2900, batched.rating));
      await setProfileRating(clamped, Math.min(200, batched.rd), 'assessment');
      if (generation !== ladderGeneration || !container.isConnected) return;
      persistAssessmentNow(assess);
      const p = await getProfile();
      if (generation !== ladderGeneration || !container.isConnected) return;
      if (assessmentDone(assess, p.rd)) {
        await finishAssessment();
        if (generation !== ladderGeneration || !container.isConnected) return;
        return;
      }
      toast(`Next: ${ASSESSMENT_LEVELS[lastLevel].label} (~${ASSESSMENT_LEVELS[lastLevel].rating}) · rating ${Math.round(p.rating)}`);
      void startGame({ ladder: true, rating: ASSESSMENT_LEVELS[lastLevel].rating });
    })();
  }

  async function finishAssessment(): Promise<void> {
    const generation = ladderGeneration;
    const prof = await updateProfile({ assessed: true });
    if (generation !== ladderGeneration || !container.isConnected) return;
    assessed = true;
    mode = 'idle';
    clearPersistedAssessment();
    const closeSheet = modal(
      el('h2', {}, 'Assessment complete'),
      el('p', {}, 'Your rating: ', el('b', { class: 'rating-big' }, String(Math.round(prof.rating))),
        el('span', { class: 'rd-badge' }, `± ${Math.round(prof.rd)}`)),
      el('p', { class: 'muted' },
        'The CPU now defaults to this level. Puzzles match it too. You can re-run the assessment anytime from Settings.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'primary', onclick: () => { closeSheet(); app.navigate('home'); } }, 'Home'),
        el('button', { onclick: () => { closeSheet(); void startGame(); } }, 'Play vs CPU'),
        el('button', { onclick: () => { closeSheet(); app.navigate('puzzles'); } }, 'Solve puzzles'))
    );
  }

  // ---------- boot ----------
  if (params.assessment) {
    void startAssessment(params.mode ?? 'probe');
  } else if (params.gameLoad) {
    resumeSavedGame(params.gameLoad);
  } else if (params.rematch) {
    void startGame();
  } else {
    controlsDefault();
    board.render();
    restoreAssessment();
  }
}