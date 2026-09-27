/** Puzzles: retry-based solving on the unified rating scale. */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { loadPuzzles, pickPuzzle } from '../puzzles';
import { applyPuzzleResult } from '../ratingOps';
import { addAttempt, getAttempts, getProfile } from '../db';
import { play } from '../sounds';
import { el } from '../ui';
import {
  matchesPuzzleMove,
  PUZZLE_TRY_LIMIT,
  puzzleScoreForMistakes,
  puzzleSolutionSan,
  type PuzzleScore,
} from '../puzzleScoring';
import type { App } from '../app';
import type { PuzzleAttempt, PuzzleItem } from '../types';

export async function mountPuzzles(container: HTMLElement, _app: App): Promise<void> {
  const feedback = el('div', { class: 'feedback' }, '');
  const solutionLine = el('p', { class: 'muted center', style: 'margin:4px 0' }, '');
  const metaBar = el('div', { class: 'puzzle-meta' });
  const controls = el('div', { class: 'section' });

  const game = new Chess();
  let current: PuzzleItem | null = null;
  let step = 0;
  let solved = false;
  let failed = false;
  let mistakeCount = 0;
  let solutionShown = false;
  let recordedCurrent = false;
  let recordingCurrent = false;
  const attempts = await getAttempts();
  const seen = new Set(attempts.map((a) => a.id));
  let streak = 0;

  const board = new Board(el('div'), game, {
    orientation: 'w',
    interactive: false,
    onMove: (m) => void onMove(m),
  });
  const boardHost = el('div', { class: 'board-wrap' }, board.el);

  const header = el('div', { class: 'hero puzzle-hero' },
    el('div', { class: 'brand' },
      el('h1', {}, 'Puzzles'),
      el('span', { class: 'est' }, `${attempts.filter((a) => a.won).length} SOLVED`))
  );

  container.append(
    header,
    metaBar,
    boardHost,
    feedback,
    solutionLine,
    controls
  );

  function setFeedback(s: string, cls = ''): void {
    feedback.textContent = s;
    feedback.className = `feedback ${cls}`;
  }

  function renderMeta(pz: PuzzleItem | null): void {
    metaBar.textContent = '';
    const p = getProfileSync();
    metaBar.append(
      el('span', { class: 'chip' }, pz ? `rated ~${pz.rating}` : 'no puzzle'),
      el('span', { class: 'chip' }, `your rating ${Math.round(p.rating)} ±${Math.round(p.rd)}`),
      el('span', { class: 'chip' }, `streak ${streak}`)
    );
    if (pz && pz.themes.length) {
      metaBar.append(el('span', { class: 'chip' }, 'themes hidden'));
    }
  }

  // Profile snapshot helper (avoids await in render).
  let profileCache = await getProfile();
  function getProfileSync() {
    return profileCache;
  }

  let loadingPuzzle = false;

  function nextPuzzle(): void {
    if (loadingPuzzle || (current && !failed && !solved)) return;
    loadingPuzzle = true;
    void (async () => {
      let all: PuzzleItem[];
      try {
        all = await loadPuzzles();
      } catch {
        loadingPuzzle = false;
        setFeedback('Puzzle bundle missing — run: npm run puzzles', 'bad');
        return;
      }
      if (all.length === 0) {
        loadingPuzzle = false;
        setFeedback('Puzzle bundle missing — run: npm run puzzles', 'bad');
        return;
      }
      if (current && !recordedCurrent) seen.add(current.id);
      const pz = pickPuzzle(all, profileCache.rating, seen);
      if (!pz) {
        loadingPuzzle = false;
        setFeedback('No puzzles left in range — you solved them all!', 'good');
        return;
      }
      current = pz;
      step = 0;
      solved = false;
      failed = false;
      mistakeCount = 0;
      solutionShown = false;
      recordedCurrent = false;
      solutionLine.textContent = '';
      // Set up: play opponent's first move from the FEN.
      const g = new Chess(pz.fen);
      const opp = pz.moves[0];
      g.move({ from: opp.slice(0, 2), to: opp.slice(2, 4), promotion: opp[4] });
      game.load(g.fen());
      board.setOrientation(g.turn());
      board.setLastMove({ from: opp.slice(0, 2), to: opp.slice(2, 4) });
      board.setInteractive(true);
      board.render();
      setFeedback(`Your move — ${PUZZLE_TRY_LIMIT} tries, full credit.`);
      renderMeta(pz);
      renderPuzzleControls();
      loadingPuzzle = false;
    })();
  }

  function renderPuzzleControls(): void {
    controls.textContent = '';
    const actions = el('div', { class: 'btn-row' });
    if (!solutionShown) {
      actions.append(el('button', {
        class: 'puzzle-solution-action',
        onclick: () => skip(),
      }, 'Show solution'));
    }

    if (failed || solved) {
      if (solutionShown) {
        actions.append(el('button', { class: 'primary', onclick: () => nextPuzzle() }, 'Next puzzle'));
      } else {
        controls.append(el('p', { class: 'tiny' }, 'View the solution to continue.'));
      }
    }
    controls.append(actions);
  }

  function skip(): void {
    if (!current || loadingPuzzle || recordingCurrent) return;
    if (solved || failed) {
      displaySolution();
      renderResultControls();
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
    displaySolution();
    renderResultControls();
  }

  function displaySolution(): void {
    if (!current || solutionShown) return;
    solutionShown = true;
    solutionLine.textContent = `Solution: ${puzzleSolutionSan(current.fen, current.moves)}`;
    controls.querySelector('.puzzle-solution-action')?.remove();
  }

  function renderResultControls(): void {
    renderPuzzleControls();
  }

  async function onMove(m: { from: string; to: string; promotion?: string }): Promise<void> {
    if (!current || solved || failed || loadingPuzzle) return;
    const solution = current.moves.slice(1);
    const expected = solution[step];
    const ok = matchesPuzzleMove(m, expected);

    if (!ok) {
      mistakeCount++;
      play('fail');
      if (mistakeCount >= PUZZLE_TRY_LIMIT) {
        failed = true;
        board.setInteractive(false);
        setFeedback('Three tries used — no credit.', 'bad');
        revealThemes();
        await record(false, 0);
        renderResultControls();
      } else {
        const attemptsLeft = PUZZLE_TRY_LIMIT - mistakeCount;
        const credit = Math.round(puzzleScoreForMistakes(mistakeCount) * 100);
        setFeedback(`Not quite — ${credit}% credit if solved; ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`, 'bad');
        renderPuzzleControls();
      }
      return;
    }

    const move = game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
    if (!move) return;
    board.setLastMove({ from: m.from, to: m.to });
    board.render();
    play(move.captured ? 'capture' : 'move');
    step++;
    if (step >= solution.length) {
      solved = true;
      play('success');
      const score = puzzleScoreForMistakes(mistakeCount);
      setFeedback(mistakeCount === 0 ? 'Solved!' : `Solved — ${Math.round(score * 100)}% credit.`, 'good');
      board.setInteractive(false);
      revealThemes();
      await record(true, score);
      renderResultControls();
      return;
    }
    // Play opponent's scripted reply, then continue.
    board.setInteractive(false);
    setTimeout(() => {
      if (!current || solved || failed) return;
      const reply = solution[step];
      if (!reply) {
        board.setInteractive(true);
        return;
      }
      const mv = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      if (!mv) return;
      board.setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      board.render();
      step++;
      if (step >= solution.length) {
        solved = true;
        play('success');
        const score = puzzleScoreForMistakes(mistakeCount);
        setFeedback(mistakeCount === 0 ? 'Solved!' : `Solved — ${Math.round(score * 100)}% credit.`, 'good');
        board.setInteractive(false);
        revealThemes();
        void record(true, score).then(renderResultControls);
      } else {
        board.setInteractive(true);
        setFeedback('Correct — keep going.');
        renderPuzzleControls();
      }
    }, 500);
  }

  function revealThemes(): void {
    if (!current) return;
    const t = current.themes.filter((x) => x !== 'short' && x !== 'long' && x !== 'veryShort');
    if (t.length) {
      metaBar.querySelector('.chip:last-child')?.replaceWith(el('span', { class: 'chip' }, t.slice(0, 3).join(', ')));
    }
  }

  async function record(won: boolean, score: PuzzleScore): Promise<void> {
    if (!current || recordedCurrent) return;
    const puzzle = current;
    recordedCurrent = true;
    recordingCurrent = true;
    seen.add(puzzle.id);
    streak = won ? streak + 1 : 0;
    try {
      const { before, after } = await applyPuzzleResult(puzzle, score);
      if (current?.id !== puzzle.id) return;
      const attempt: PuzzleAttempt = {
        id: puzzle.id,
        won,
        score,
        mistakes: mistakeCount,
        rating: puzzle.rating,
        ts: Date.now(),
      };
      await addAttempt(attempt);
      profileCache = await getProfile();
      if (current?.id !== puzzle.id) return;
      renderMeta(puzzle);
      setFeedback(
        `${won ? 'Solved' : 'Missed'} — ${Math.round(score * 100)}% credit · rating ${Math.round(before)} → ${Math.round(after)}`,
        won ? 'good' : 'bad'
      );
    } finally {
      recordingCurrent = false;
    }
  }

  nextPuzzle();
}
