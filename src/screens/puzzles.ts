/** Puzzles: strict Lichess-style solving on the unified rating scale. */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { loadPuzzles, pickPuzzle } from '../puzzles';
import { applyPuzzleResult } from '../ratingOps';
import { addAttempt, getAttempts, getProfile } from '../db';
import { play } from '../sounds';
import { el, toast } from '../ui';
import type { App } from '../app';
import type { PuzzleItem } from '../types';

export async function mountPuzzles(container: HTMLElement, _app: App): Promise<void> {
  const feedback = el('div', { class: 'feedback' }, '');
  const metaBar = el('div', { class: 'puzzle-meta' });
  const controls = el('div', { class: 'section' });

  const game = new Chess();
  let current: PuzzleItem | null = null;
  let step = 0;
  let solved = false;
  let failed = false;
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

  function nextPuzzle(): void {
    void (async () => {
      const all = await loadPuzzles().catch(() => [] as PuzzleItem[]);
      if (all.length === 0) {
        setFeedback('Puzzle bundle missing — run: npm run puzzles', 'bad');
        return;
      }
      const pz = pickPuzzle(all, profileCache.rating, seen);
      if (!pz) {
        setFeedback('No puzzles left in range — you solved them all!', 'good');
        return;
      }
      current = pz;
      step = 0;
      solved = false;
      failed = false;
      // Set up: play opponent's first move from the FEN.
      const g = new Chess(pz.fen);
      const opp = pz.moves[0];
      g.move({ from: opp.slice(0, 2), to: opp.slice(2, 4), promotion: opp[4] });
      game.load(g.fen());
      board.setOrientation(g.turn());
      board.setLastMove({ from: opp.slice(0, 2), to: opp.slice(2, 4) });
      board.setInteractive(true);
      board.render();
      setFeedback('Your move.');
      renderMeta(pz);
      controls.textContent = '';
      controls.append(
        el('div', { class: 'btn-row' },
          el('button', { onclick: () => skip() }, 'Skip'),
          el('button', { onclick: () => nextPuzzle() }, 'Next'))
      );
    })();
  }

  function skip(): void {
    if (!current) return;
    seen.add(current.id);
    toast('Skipped — no rating change.');
    nextPuzzle();
  }

  async function onMove(m: { from: string; to: string; promotion?: string }): Promise<void> {
    if (!current || solved || failed) return;
    const solution = current.moves.slice(1);
    const expected = solution[step];
    const ok = expected && m.from === expected.slice(0, 2) && m.to === expected.slice(2, 4);
    const move = game.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
    if (!move) return;
    board.setLastMove({ from: m.from, to: m.to });
    board.render();

    if (!ok) {
      failed = true;
      play('fail');
      setFeedback('Wrong — puzzle failed.', 'bad');
      board.setInteractive(false);
      await record(false);
      return;
    }
    play(move.captured ? 'capture' : 'move');
    step++;
    if (step >= solution.length) {
      solved = true;
      play('success');
      setFeedback('Solved!', 'good');
      board.setInteractive(false);
      revealThemes();
      await record(true);
      return;
    }
    // Play opponent's scripted reply, then continue.
    setTimeout(() => {
      const reply = solution[step];
      if (!reply) return;
      const mv = game.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      if (!mv) return;
      board.setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      board.render();
      step++;
      if (step >= solution.length) {
        solved = true;
        play('success');
        setFeedback('Solved!', 'good');
        board.setInteractive(false);
        revealThemes();
        void record(true);
      } else {
        setFeedback('Correct — keep going.');
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

  async function record(won: boolean): Promise<void> {
    if (!current) return;
    seen.add(current.id);
    streak = won ? streak + 1 : 0;
    const { before, after } = await applyPuzzleResult(current, won);
    await addAttempt({ id: current.id, won, rating: current.rating, ts: Date.now() });
    profileCache = await getProfile();
    renderMeta(current);      setFeedback(
      `${won ? 'Solved' : 'Missed'} — rating ${Math.round(before)} → ${Math.round(after)}`,
      won ? 'good' : 'bad'
    );
  }

  nextPuzzle();
}
