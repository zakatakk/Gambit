/**
 * Analysis: study board with a live eval bar, engine best line, FEN loading,
 * and a Lichess-style position editor (place/remove pieces anywhere, choose
 * the side to move). Boards share the real Board component.
 */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { engine } from '../engineClient';
import { getSettings } from '../db';
import { applyBoardTheme, applyPieceSet, pieceImg } from '../pieces';
import { play } from '../sounds';
import { el, toast } from '../ui';
import type { App } from '../app';
import type { Color } from '../types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

const TRAY_PIECES = ['k', 'q', 'r', 'b', 'n', 'p'] as const;

export async function mountAnalysis(container: HTMLElement, _app: App): Promise<void> {
  const settings = await getSettings();
  if (!container.isConnected) return;
  applyPieceSet(settings.pieceSet);
  applyBoardTheme(settings.boardTheme);

  const game = new Chess();
  let disposed = false;
  let analysing = false;
  let generation = 0;
  let editMode = false;
  /** Piece waiting to be placed in edit mode ('trash' removes on tap). */
  let brush: { color: Color; type: string } | 'trash' | null = null;
  /** History of FENs for undo/redo navigation. */
  const past: string[] = [];
  const future: string[] = [];
  /** Variations: extra lines from the current position, keyed by their first move SAN. */
  const lines = new Map<string, string[]>();

  const boardHost = el('div', { class: 'board-wrap analysis-board' });
  const evalFill = el('div', {});
  const evalBar = el('div', { class: 'eval-bar' }, evalFill);
  const evalLabel = el('span', { class: 'eval-label' }, '0.0');
  const lineLabel = el('div', { class: 'analysis-line muted' }, 'Move a piece or load a FEN to analyze.');
  const statusLine = el('div', { class: 'status-bar' }, '');
  const moveList = el('div', { class: 'move-list' }, '—');
  const tray = el('div', { class: 'tray' });
  const turnButton = el('button', { class: 'small' }, 'White to move');

  const board = new Board(boardHost, game, {
    orientation: 'w',
    interactive: true,
    autoQueen: settings.autoQueen,
    showCoords: settings.showCoords,
    onEdit: (action) => handleEdit(action),
    onMove: (move) => {
      // The Board validates legality; applying the move is this screen's job.
      pushHistory();
      const played = game.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
      if (!played) {
        past.pop();
        return;
      }
      board.setLastMove({ from: played.from, to: played.to });
      onPositionChanged(true);
    },
  });

  const fenInput = el('input', { type: 'text', placeholder: 'Paste a FEN to explore…' }) as HTMLInputElement;
  const loadButton = el('button', { onclick: () => loadFen() }, 'Load FEN');
  const flipButton = el('button', { onclick: () => board.setOrientation(board.orientation === 'w' ? 'b' : 'w') }, 'Flip');
  const resetButton = el('button', { onclick: () => loadFenString(START_FEN) }, 'Start');
  const clearButton = el('button', { onclick: () => loadFenString(EMPTY_FEN, true) }, 'Clear');
  const copyButton = el('button', { onclick: () => copyFen() }, 'Copy FEN');
  const editButton = el('button', { class: 'edit-toggle', onclick: () => setEditMode(!editMode) }, 'Edit position');
  const undoButton = el('button', { onclick: () => stepHistory(-1) }, 'Undo');
  const redoButton = el('button', { onclick: () => stepHistory(1) }, 'Redo');

  container.append(
    el('div', { class: 'hero analysis-hero' },
      el('div', { class: 'brand' }, el('h1', {}, 'Analysis')),
      el('div', { class: 'analysis-eval' }, evalBar, evalLabel)),
    boardHost,
    lineLabel,
    moveList,
    tray,
    el('div', { class: 'section analysis-config' },
      el('div', { class: 'btn-row' }, undoButton, redoButton, flipButton),
      el('div', { class: 'btn-row' }, editButton, turnButton, resetButton, clearButton),
      el('div', { class: 'row' }, fenInput, loadButton),
      el('div', { class: 'btn-row' }, copyButton),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'Analyze freely. In Edit position: tap a piece to place it, tap a square with a brush to add, drag pieces anywhere, right-click (or long-press then trash) to remove.')),
    statusLine
  );

  container.addEventListener('screen-dispose', () => {
    disposed = true;
    generation++;
    document.body.classList.remove('editing');
    engine.cancelSearch();
  }, { once: true });

  function setEditMode(on: boolean): void {
    editMode = on;
    // Flag lets CSS shrink the board so the extra tray row still fits one screen.
    document.body.classList.toggle('editing', on);
    board.setEditMode(on);
    editButton.classList.toggle('active', on);
    tray.style.display = on ? 'flex' : 'none';
    turnButton.style.display = on ? '' : 'none';
    if (on) renderTray();
  }

  function renderTray(): void {
    tray.replaceChildren();
    for (const color of ['w', 'b'] as const) {
      for (const type of TRAY_PIECES) {
        const btn = el('button', { class: 'tray-piece' });
        btn.appendChild(pieceImg(type, color));
        btn.addEventListener('click', () => {
          brush = { color, type };
          [...tray.querySelectorAll('.tray-piece')].forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
        tray.appendChild(btn);
      }
    }
    const trash = el('button', { class: 'tray-trash', title: 'Remove pieces' }, 'Trash');
    trash.addEventListener('click', () => {
      brush = 'trash';
      [...tray.querySelectorAll('.tray-piece, .tray-trash')].forEach((b) => b.classList.remove('active'));
      trash.classList.add('active');
    });
    tray.appendChild(trash);
  }

  /** Editor actions from the Board: taps place the brush, drags relocate, right-click removes. */
  function handleEdit(action: { type: 'tap' | 'move' | 'remove'; from?: string; to?: string }): void {
    if (action.type === 'move' && action.from && action.to) {
      relocate(action.from, action.to);
      return;
    }
    if (action.type === 'remove' && action.from) {
      removeAt(action.from);
      return;
    }
    if (action.type === 'tap' && action.to) {
      if (brush === 'trash') {
        removeAt(action.to);
        return;
      }
      if (brush) placePiece(brush, action.to);
    }
  }

  function pushHistory(): void {
    past.push(game.fen());
    if (past.length > 200) past.shift();
    future.length = 0;
  }

  /** Apply a piece map (square -> FEN letter) to the live game, tolerating
   * illegal mid-edit states (chess.js requires both kings, no pawns on rank
   * 1/8, no impossible checks). Returns false when not loadable. */
  function applyPieces(pieces: Record<string, string>, lastMove?: { from: string; to: string }): boolean {
    const rows: string[] = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (const f of 'abcdefgh') {
        const piece = pieces[`${f}${r}`];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          row += String(empty);
          empty = 0;
        }
        row += piece;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    const parts = game.fen().split(' ');
    const candidate = `${rows.join('/')} ${parts[1]} - - 0 1`;
    const snapshot = game.fen();
    try {
      game.load(candidate);
    } catch {
      game.load(snapshot); // not a loadable position; keep the old one
      return false;
    }
    board.setLastMove(lastMove ?? null);
    board.render();
    onPositionChanged(false);
    return true;
  }

  function boardMap(): Record<string, string> {
    const pieces: Record<string, string> = {};
    for (const row of game.board()) {
      for (const sq of row) {
        if (sq) pieces[sq.square] = sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
      }
    }
    return pieces;
  }

  function placePiece(piece: { color: Color; type: string }, to: string): void {
    const pieces = boardMap();
    pieces[to] = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    pushHistory();
    if (!applyPieces(pieces)) {
      past.pop(); // edit rejected; history untouched
      toast('Position not loadable (needs both kings, legal checks).');
    }
  }

  function removeAt(from: string): void {
    if (!game.get(from as never)) return;
    const pieces = boardMap();
    delete pieces[from];
    pushHistory();
    if (!applyPieces(pieces)) {
      past.pop();
      toast('Position not loadable (needs both kings, legal checks).');
    }
  }

  function relocate(from: string, to: string): void {
    const pieces = boardMap();
    const moved = pieces[from];
    if (!moved) return;
    delete pieces[from];
    pieces[to] = moved;
    pushHistory();
    if (!applyPieces(pieces, { from, to })) {
      past.pop();
      toast('Position not loadable (needs both kings, legal checks).');
    }
  }

  function stepHistory(direction: -1 | 1): void {
    if (direction === -1 && past.length > 0) {
      future.push(game.fen());
      game.load(past.pop()!);
    } else if (direction === 1 && future.length > 0) {
      past.push(game.fen());
      game.load(future.pop()!);
    } else {
      return;
    }
    board.setLastMove(null);
    board.render();
    onPositionChanged(false);
  }

  function loadFen(): void {
    const candidate = fenInput.value.trim();
    if (!candidate) return;
    loadFenString(candidate);
    fenInput.value = '';
  }

  function loadFenString(fen: string, keepTurn = false): void {
    const probe = new Chess();
    try {
      probe.load(fen);
    } catch (error) {
      toast(`Invalid FEN: ${(error as Error).message}`);
      return;
    }
    pushHistory();
    if (keepTurn) {
      const turn = game.turn();
      game.load(fen.replace(/\s[wb]\s/, ` ${turn} `));
    } else {
      game.load(fen);
    }
    board.setLastMove(null);
    board.setOrientation(game.turn());
    board.render();
    onPositionChanged(false);
  }

  async function copyFen(): Promise<void> {
    try {
      await navigator.clipboard.writeText(game.fen());
      toast('FEN copied.');
    } catch {
      toast('Could not access the clipboard.');
    }
  }

  function onPositionChanged(byLegalMove: boolean): void {
    play('move');
    board.render();
    renderMoves(byLegalMove);
    renderTurn();
    scheduleAnalysis();
  }

  function renderTurn(): void {
    const white = game.turn() === 'w';
    turnButton.textContent = white ? 'White to move' : 'Black to move';
    turnButton.onclick = () => {
      const flipped = white ? 'b' : 'w';
      swapTurn(flipped);
    };
  }

  function swapTurn(turn: Color): void {
    const parts = game.fen().split(' ');
    parts[1] = turn;
    // Manual edits: clear en passant, reset the halfmove/fullmove counters.
    parts[3] = '-';
    parts[4] = '0';
    parts[5] = '1';
    game.load(parts.join(' '));
    board.render();
    onPositionChanged(false);
  }

  function renderMoves(fromLegalMove: boolean): void {
    const hist = game.history({ verbose: true });
    if (hist.length === 0) {
      moveList.textContent = '—';
      return;
    }
    moveList.textContent = '';
    for (let i = 0; i < hist.length; i += 2) {
      moveList.append(el('span', { class: 'ply' },
        el('span', { class: 'num' }, `${i / 2 + 1}.`),
        ` ${hist[i].san}${hist[i + 1] ? ' ' + hist[i + 1].san : ''}`));
    }
    if (fromLegalMove) lines.set(`${hist.length}`, hist.map((m) => m.san));
  }

  function scheduleAnalysis(): void {
    const myGeneration = ++generation;
    if (analysing) engine.cancelSearch();
    void runAnalysis(myGeneration);
  }

  async function runAnalysis(myGeneration: number): Promise<void> {
    if (disposed || myGeneration !== generation) return;
    const counts = countPieces(game);
    if (counts.w.k === 0 || counts.b.k === 0) {
      lineLabel.textContent = 'Add both kings to analyze this position.';
      setStatus('');
      return;
    }
    if (game.isGameOver()) {
      lineLabel.textContent = game.isCheckmate() ? 'Checkmate.' : 'Draw.';
      return;
    }
    analysing = true;
    setStatus('Evaluating…');
    try {
      await engine.init('lite');
    } catch {
      setStatus('Engine unavailable — board still works.');
      analysing = false;
      return;
    }
    if (disposed || myGeneration !== generation) {
      analysing = false;
      return;
    }
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

  function countPieces(g: Chess): { w: Record<string, number>; b: Record<string, number> } {
    const counts = { w: {} as Record<string, number>, b: {} as Record<string, number> };
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq) continue;
        counts[sq.color][sq.type] = (counts[sq.color][sq.type] ?? 0) + 1;
      }
    }
    return counts;
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
  setEditMode(false);
  onPositionChanged(false);
}
