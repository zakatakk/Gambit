/** Puzzles: retry-based solving on the unified rating scale. */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { loadPuzzles, pickPuzzle } from '../puzzles';
import { applyPuzzleResult } from '../ratingOps';
import { getAttempts, getProfile } from '../db';
import { play } from '../sounds';
import { el } from '../ui';
import type { App } from '../app';
import type { PuzzleAttempt, PuzzleItem } from '../types';
import {
  matchesPuzzleMove,
  PUZZLE_TRY_LIMIT,
  puzzleScoreForMistakes,
  puzzleSolutionSan,
  type PuzzleScore,
} from '../puzzleScoring';

export async function mountPuzzles(container: HTMLElement, _app: App): Promise<void> {
  const feedback = el('div', { class: 'feedback' }, '');
  const solutionLine = el('p', { class: 'muted center', style: 'margin:4px 0' }, '');
  const metaBar = el('div', { class: 'puzzle-meta' });
  const controls = el('div', { class: 'section' });
  const attempts = await getAttempts();
  if (!container.isConnected) return;

  const seen = new Set(attempts.map((attempt) => attempt.id));
  const game = new Chess();
  let current: PuzzleItem | null = null;
  let inFlightPuzzleId: string | null = null;
  let step = 0;
  let solved = false;
  let failed = false;
  let mistakeCount = 0;
  let solutionShown = false;
  let recordedCurrent = false;
  let recordingCurrent = false;
  let pendingRecord: { puzzle: PuzzleItem; won: boolean; score: PuzzleScore; mistakes: number } | null = null;
  let streak = 0;
  let loadingPuzzle = false;
  let profileCache = await getProfile();
  if (!container.isConnected) return;

  let puzzleGeneration = 0;
  let activeTimeout: ReturnType<typeof setTimeout> | undefined;
  let puzzlesPromise: Promise<PuzzleItem[]> | null = null;
  const dispose = () => {
    puzzleGeneration++;
    if (activeTimeout !== undefined) clearTimeout(activeTimeout);
  };
  container.addEventListener('screen-dispose', dispose, { once: true });

  const board = new Board(el('div'), game, {
    orientation: 'w',
    interactive: false,
    onMove: (move) => void onMove(move),
  });
  const boardHost = el('div', { class: 'board-wrap' }, board.el);
  const header = el('div', { class: 'hero puzzle-hero' },
    el('div', { class: 'brand' },
      el('h1', {}, 'Puzzles'),
      el('span', { class: 'est' }, `${attempts.filter((attempt) => attempt.won).length} SOLVED`))
  );
  container.append(header, metaBar, boardHost, feedback, solutionLine, controls);

  function setFeedback(message: string, className = ''): void {
    feedback.textContent = message;
    feedback.className = `feedback ${className}`;
  }

  function renderMeta(puzzle: PuzzleItem | null): void {
    metaBar.replaceChildren();
    metaBar.append(
      el('span', { class: 'chip' }, puzzle ? `rated ~${puzzle.rating}` : 'no puzzle'),
      el('span', { class: 'chip' }, `your rating ${Math.round(profileCache.rating)} ±${Math.round(profileCache.rd)}`),
      el('span', { class: 'chip' }, `streak ${streak}`)
    );
    if (puzzle?.themes.length) metaBar.append(el('span', { class: 'chip' }, 'themes hidden'));
  }

  function loadPuzzleBundle(): Promise<PuzzleItem[]> {
    puzzlesPromise ??= loadPuzzles().catch((error) => {
      puzzlesPromise = null;
      throw error;
    });
    return puzzlesPromise;
  }

  async function nextPuzzle(): Promise<void> {
    if (loadingPuzzle || recordingCurrent || (current && !failed && !solved)) return;
    if (activeTimeout !== undefined) clearTimeout(activeTimeout);
    activeTimeout = undefined;
    loadingPuzzle = true;
    const generation = ++puzzleGeneration;
    board.setInteractive(false);
    try {
      const all = await loadPuzzleBundle();
      if (generation !== puzzleGeneration || !container.isConnected) return;
      if (all.length === 0) {
        setFeedback('Puzzle bundle is empty.', 'bad');
        return;
      }
      if (current && !recordedCurrent) seen.add(current.id);
      const puzzle = pickPuzzle(all, profileCache.rating, seen);
      if (!puzzle) {
        setFeedback('No puzzles left in your rating range.', 'good');
        return;
      }

      current = puzzle;
      pendingRecord = null;
      step = 0;
      solved = false;
      failed = false;
      mistakeCount = 0;
      solutionShown = false;
      recordedCurrent = false;
      solutionLine.textContent = '';
      const position = new Chess(puzzle.fen);
      const opponentMove = puzzle.moves[0];
      const played = position.move({
        from: opponentMove.slice(0, 2),
        to: opponentMove.slice(2, 4),
        promotion: opponentMove[4],
      });
      if (!played) throw new Error(`Invalid opening move in puzzle ${puzzle.id}`);
      game.load(position.fen());
      board.setOrientation(position.turn());
      board.setLastMove({ from: opponentMove.slice(0, 2), to: opponentMove.slice(2, 4) });
      board.setInteractive(true);
      board.render();
      setFeedback(`Your move — ${PUZZLE_TRY_LIMIT} tries, full credit.`);
      renderMeta(puzzle);
      renderPuzzleControls();
    } catch (error) {
      if (generation === puzzleGeneration && container.isConnected) {
        if (current && !recordedCurrent) seen.add(current.id);
        current = null;
        inFlightPuzzleId = null;
        solved = false;
        failed = true;
        board.setInteractive(false);
        setFeedback(`Could not load puzzle: ${(error as Error).message}`, 'bad');
        controls.replaceChildren(el('button', {
          class: 'primary',
          onclick: () => void nextPuzzle(),
        }, 'Try another puzzle'));
      }
    } finally {
      if (generation === puzzleGeneration) loadingPuzzle = false;
    }
  }

  function renderPuzzleControls(): void {
    controls.replaceChildren();
    const actions = el('div', { class: 'btn-row' });
    if (!solutionShown) {
      actions.append(el('button', { class: 'puzzle-solution-action', onclick: () => skip() }, 'Show solution'));
    }
    const hasPendingRecord = pendingRecord?.puzzle.id === current?.id;
    if (hasPendingRecord) {
      const pending = pendingRecord!;
      actions.append(el('button', {
        onclick: () => void record(pending.won, pending.score, pending.puzzle, pending.mistakes),
      }, 'Retry saving result'));
    }
    if (!hasPendingRecord && (solved || (failed && solutionShown))) {
      actions.append(el('button', { class: 'primary', onclick: () => void nextPuzzle() }, 'Next puzzle'));
    } else if (!hasPendingRecord && failed) {
      controls.append(el('p', { class: 'tiny' }, 'View the solution to continue.'));
    }
    controls.append(actions);
  }

  function skip(): void {
    if (!current || loadingPuzzle || recordingCurrent) return;
    if (solved || failed) {
      displaySolution();
      renderPuzzleControls();
      return;
    }
    void showSolution();
  }

  async function showSolution(): Promise<void> {
    if (!current || solved || failed || loadingPuzzle || recordingCurrent) return;
    failed = true;
    board.setInteractive(false);
    setFeedback('Puzzle skipped — no credit.', 'bad');
    revealThemes();
    await record(false, 0);
    if (!container.isConnected) return;
    displaySolution();
    renderPuzzleControls();
  }

  function displaySolution(): void {
    if (!current || solutionShown) return;
    solutionShown = true;
    solutionLine.textContent = `Solution: ${puzzleSolutionSan(current.fen, current.moves)}`;
    controls.querySelector('.puzzle-solution-action')?.remove();
  }

  async function onMove(move: { from: string; to: string; promotion?: string }): Promise<void> {
    if (!container.isConnected || !current || solved || failed || loadingPuzzle) return;
    const puzzle = current;
    const solution = puzzle.moves.slice(1);
    const expected = solution[step];

    if (!matchesPuzzleMove(move, expected)) {
      mistakeCount++;
      play('fail');
      if (mistakeCount >= PUZZLE_TRY_LIMIT) {
        failed = true;
        board.setInteractive(false);
        setFeedback('Three tries used — no credit.', 'bad');
        revealThemes();
        await record(false, 0);
        if (container.isConnected) renderPuzzleControls();
      } else {
        const attemptsLeft = PUZZLE_TRY_LIMIT - mistakeCount;
        const credit = Math.round(puzzleScoreForMistakes(mistakeCount) * 100);
        setFeedback(`Not quite — ${credit}% credit if solved; ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`, 'bad');
        renderPuzzleControls();
      }
      return;
    }

    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    if (!played) return;
    board.setLastMove({ from: move.from, to: move.to });
    board.render();
    play(played.captured ? 'capture' : 'move');
    step++;
    if (step >= solution.length) {
      solved = true;
      play('success');
      await completePuzzle(puzzle);
      return;
    }

    board.setInteractive(false);
    const generation = puzzleGeneration;
    activeTimeout = setTimeout(() => {
      if (!container.isConnected || generation !== puzzleGeneration || current !== puzzle || solved || failed) return;
      const reply = solution[step];
      if (!reply) {
        board.setInteractive(true);
        return;
      }
      const response = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      if (!response) {
        failed = true;
        board.setInteractive(false);
        setFeedback(`Invalid solution line in puzzle ${puzzle.id}.`, 'bad');
        renderPuzzleControls();
        return;
      }
      board.setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      board.render();
      step++;
      if (step >= solution.length) {
        solved = true;
        play('success');
        void completePuzzle(puzzle);
      } else {
        board.setInteractive(true);
        setFeedback('Correct — keep going.');
        renderPuzzleControls();
      }
    }, 500);
  }

  async function completePuzzle(puzzle: PuzzleItem): Promise<void> {
    const score = puzzleScoreForMistakes(mistakeCount);
    setFeedback(mistakeCount === 0 ? 'Solved!' : `Solved — ${Math.round(score * 100)}% credit.`, 'good');
    board.setInteractive(false);
    revealThemes();
    await record(true, score, puzzle);
    if (container.isConnected) renderPuzzleControls();
  }

  function revealThemes(): void {
    if (!current) return;
    const themes = current.themes.filter((theme) => !['short', 'long', 'veryShort'].includes(theme));
    if (themes.length) metaBar.lastElementChild?.replaceWith(
      el('span', { class: 'chip' }, themes.slice(0, 3).join(', '))
    );
  }

  async function record(
    won: boolean,
    score: PuzzleScore,
    puzzle = current,
    mistakes = mistakeCount
  ): Promise<void> {
    if (!puzzle || (current?.id === puzzle.id && recordedCurrent) || inFlightPuzzleId === puzzle.id) return;
    inFlightPuzzleId = puzzle.id;
    if (current?.id === puzzle.id) recordingCurrent = true;
    seen.add(puzzle.id);
    const attempt: PuzzleAttempt = {
      id: puzzle.id,
      won,
      score,
      mistakes,
      rating: puzzle.rating,
      ts: Date.now(),
    };
    try {
      const ratingChange = await applyPuzzleResult(puzzle, score, attempt);
      seen.add(puzzle.id);
      if (current?.id !== puzzle.id) return;
      recordedCurrent = true;
      pendingRecord = null;
      streak = won ? streak + 1 : 0;
      profileCache = {
        ...profileCache,
        rating: ratingChange.after,
        rd: ratingChange.rd,
        lastPlayed: attempt.ts,
      };
      if (!container.isConnected) return;
      renderMeta(puzzle);
      setFeedback(
        `${won ? 'Solved' : 'Missed'} — ${Math.round(score * 100)}% credit · rating ${Math.round(ratingChange.before)} → ${Math.round(ratingChange.after)}`,
        won ? 'good' : 'bad'
      );
    } catch (error) {
      if (container.isConnected && current?.id === puzzle.id) {
        pendingRecord = { puzzle, won, score, mistakes };
        setFeedback(`Could not save puzzle result: ${(error as Error).message}`, 'bad');
      }
    } finally {
      if (inFlightPuzzleId === puzzle.id) inFlightPuzzleId = null;
      if (current?.id === puzzle.id) {
        recordingCurrent = false;
        if (container.isConnected) renderPuzzleControls();
      }
    }
  }

  void nextPuzzle();
}
