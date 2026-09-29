/**
 * Analysis: free exploration board with a live eval bar, engine best line and
 * a FEN loader. Uses the shared Board component for identical look and input.
 */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { engine } from '../engineClient';
import { getSettings } from '../db';
import { applyBoardTheme, applyPieceSet } from '../pieces';
import { play } from '../sounds';
import { el, toast } from '../ui';
import type { App } from '../app';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export async function mountAnalysis(container: HTMLElement, app: App): Promise<void> {
  const [settings] = await Promise.all([getSettings()]);
  if (!container.isConnected) return;
  applyPieceSet(settings.pieceSet);
  applyBoardTheme(settings.boardTheme);

  const game = new Chess();
  let disposed = false;
  let analysing = false;
  let generation = 0;

  const boardHost = el('div', { class: 'board-wrap analysis-board' });
  const evalFill = el('div', {});
  const evalBar = el('div', { class: 'eval-bar' }, evalFill);
  const evalLabel = el('span', { class: 'eval-label' }, '0.0');
  const lineLabel = el('div', { class: 'analysis-line muted' }, 'Best line will appear here.');
  const statusLine = el('div', { class: 'status-bar' }, '');

  const board = new Board(boardHost, game, {
    orientation: 'w',
    interactive: true,
    autoQueen: settings.autoQueen,
    showCoords: settings.showCoords,
    onMove: () => onPositionChanged(),
  });

  const fenInput = el('input', { type: 'text', placeholder: 'Paste a FEN to explore…' }) as HTMLInputElement;
  const loadButton = el('button', { onclick: () => loadFen() }, 'Load FEN');
  const flipButton = el('button', { onclick: () => {
    board.setOrientation(board.orientation === 'w' ? 'b' : 'w');
  } }, 'Flip board');
  const resetButton = el('button', { onclick: () => {
    game.load(START_FEN);
    onPositionChanged();
  } }, 'Reset');

  container.append(
    el('div', { class: 'hero' },
      el('div', { class: 'brand' }, el('h1', {}, 'Analysis')),
      el('div', { class: 'analysis-eval' }, evalBar, evalLabel)),
    boardHost,
    lineLabel,
    el('div', { class: 'section' },
      el('div', { class: 'row' }, fenInput, loadButton),
      el('div', { class: 'btn-row' }, flipButton, resetButton),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'Move pieces freely. The engine evaluates the position after every change.')),
    statusLine
  );

  container.addEventListener('screen-dispose', () => {
    disposed = true;
    generation++;
    engine.cancelSearch();
  }, { once: true });

  /** Manual FEN entry: keep position history consistent by loading fresh. */
  function loadFen(): void {
    const candidate = fenInput.value.trim();
    if (!candidate) return;
    const probe = new Chess();
    try {
      probe.load(candidate);
    } catch (error) {
      toast(`Invalid FEN: ${(error as Error).message}`);
      return;
    }
    game.load(probe.fen());
    fenInput.value = '';
    onPositionChanged();
  }

  function onPositionChanged(): void {
    play(game.history().length ? 'move' : 'move');
    renderSide();
    scheduleAnalysis();
  }

  function renderSide(): void {
    const summary = capturedSummaryOf(game);
    const cp = summary;
    const clamped = Math.max(-1000, Math.min(1000, cp));
    const whitePct = 50 + (clamped / 1000) * 45;
    evalFill.style.width = `${whitePct}%`;
    evalLabel.textContent = cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1);
  }

  /** +pawns from White's perspective (heuristic material eval for the bar). */
  function capturedSummaryOf(game: Chess): number {
    const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    let total = 0;
    for (const row of game.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue;
        total += sq.color === 'w' ? VALUES[sq.type] : -VALUES[sq.type];
      }
    }
    // Material-only: bar shows a centipawn-ish material balance until the engine reports.
    return total * 100;
  }

  function scheduleAnalysis(): void {
    const myGeneration = ++generation;
    if (analysing) engine.cancelSearch();
    void (async () => {
      await runAnalysis(myGeneration);
    })();
  }

  async function runAnalysis(myGeneration: number): Promise<void> {
    if (disposed || myGeneration !== generation) return;
    if (game.isGameOver()) {
      lineLabel.textContent = game.isCheckmate() ? 'Checkmate.' : 'Draw.';
      return;
    }
    analysing = true;
    setStatus('Evaluating…');
    const fen = game.fen();
    const turnSign = game.turn() === 'w' ? 1 : -1;
    try {
      const move = await engine.analyse(fen, 900, (cp, mate, pv) => {
        if (disposed || myGeneration !== generation || game.fen() !== fen) return;
        if (mate !== null) {
          evalLabel.textContent = `M${Math.abs(mate)}`;
          evalFill.style.width = mate * turnSign > 0 ? '96%' : '4%';
        } else if (cp !== null) {
          const whiteCp = cp * turnSign;
          const clamped = Math.max(-1000, Math.min(1000, whiteCp));
          evalFill.style.width = `${50 + (clamped / 1000) * 45}%`;
          evalLabel.textContent = whiteCp > 0 ? `+${(whiteCp / 100).toFixed(1)}` : (whiteCp / 100).toFixed(1);
        }
        if (pv.length > 0) lineLabel.textContent = `Best line: ${pvToSan(fen, pv)}`;
      }, 1);
      if (disposed || myGeneration !== generation || game.fen() !== fen) return;
      setStatus(`Engine prefers ${move.from}→${move.to}.`);
    } catch {
      if (!disposed && myGeneration === generation) setStatus('Engine unavailable — board still works.');
    } finally {
      if (myGeneration === generation) analysing = false;
    }
  }

  function pvToSan(fen: string, pv: string[]): string {
    const probe = new Chess(fen);
    const sans: string[] = [];
    for (const uci of pv.slice(0, 6)) {
      try {
        sans.push(probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      } catch {
        break;
      }
    }
    return sans.join(' ');
  }

  function setStatus(s: string): void {
    statusLine.textContent = s;
  }

  // ---------- boot ----------
  if (app) onPositionChanged();
}
