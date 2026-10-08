/**
 * Analysis: study board with a vertical eval bar, a clickable move list with
 * keyboard navigation, the top engine lines (click one to play it), best-move
 * hint arrows, FEN loading, and a position editor (piece pockets, tap to place,
 * drag to move, drag off the board to delete). Boards share the real Board.
 */
import { Chess } from 'chess.js';
import { Board, boardSquareAt, type EditBrush } from '../board';
import { AnalysisLine, evalFraction, formatEval } from '../analysisLine';
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
const FILES_BY_INDEX = 'abcdefgh';
/** Engine lines shown in the panel (MultiPV). */
const ENGINE_LINES = 3;
/** Search time per position; long enough to settle the top lines. */
const THINK_MS = 1000;
/** Plies of each engine line shown in the panel. */
const PV_PLIES = 8;

interface EngineInfo {
  multipv: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
}

export async function mountAnalysis(container: HTMLElement, _app: App): Promise<void> {
  const settings = await getSettings();
  if (!container.isConnected) return;
  applyPieceSet(settings.pieceSet);
  applyBoardTheme(settings.boardTheme);

  const game = new Chess();
  const line = new AnalysisLine(START_FEN);
  let disposed = false;
  let generation = 0;
  let editMode = false;
  /** Piece waiting to be placed in edit mode ('trash' removes on tap). */
  let brush: { color: Color; type: string } | 'trash' | null = null;
  /** Engine output for `engineFen`, keyed by MultiPV line number. */
  let engineLines = new Map<number, EngineInfo>();
  let engineFen = '';
  /** Message shown in the engine panel when there are no lines yet. */
  let infoText = '';

  const boardHost = el('div', { class: 'board-wrap analysis-board' });
  const evalFill = el('div', { class: 'eval-v-fill' });
  const evalBar = el('div', { class: 'eval-v', title: 'White advantage' }, evalFill);
  const evalLabel = el('div', { class: 'eval-v-label' }, '…');
  // The eval column sits inside the board wrapper (ordered first in CSS), so
  // the bar always matches the board height.
  boardHost.append(el('div', { class: 'eval-col' }, evalBar, evalLabel));
  const engineHead = el('div', { class: 'engine-head' }, 'Engine');
  const linesList = el('div', { class: 'engine-lines' });
  const statusLine = el('div', { class: 'status-bar' }, '');
  const moveList = el('div', { class: 'move-list' });

  const board = new Board(boardHost, game, {
    orientation: 'w',
    interactive: true,
    autoQueen: settings.autoQueen,
    showCoords: settings.showCoords,
    markup: true,
    onEdit: (action) => handleEdit(action),
    onMove: (move) => {
      // The Board validates legality; the line records the move.
      playUci(`${move.from}${move.to}${move.promotion ?? ''}`);
    },
  });
  board.setBrushResolver(() => brush as EditBrush);

  // ---- edit-mode furniture (hidden unless editing) -----------------------
  const pockets = el('div', { class: 'pockets' });
  const pocketBtns: Record<string, HTMLButtonElement> = {};
  const editBar = el('div', { class: 'edit-bar' });
  const castlingButton = el('button', { class: 'edit-chip on', onclick: () => toggleCastling() }, 'Castling');
  const epButton = el('button', { class: 'edit-chip on', onclick: () => toggleEnPassant() }, 'En passant');
  const turnButton = el('button', { class: 'edit-chip on', onclick: () => toggleTurn() }, 'White to move');
  const editCopyButton = el('button', { class: 'edit-chip', onclick: () => void copyFen() }, 'Copy FEN');

  // ---- navigation ----------------------------------------------------------
  const navFirst = el('button', { class: 'nav-btn', 'aria-label': 'First move', onclick: () => goTo(0) }, '«');
  const navPrev = el('button', { class: 'nav-btn', 'aria-label': 'Previous move', onclick: () => goTo(line.index - 1) }, '‹');
  const navNext = el('button', { class: 'nav-btn', 'aria-label': 'Next move', onclick: () => goTo(line.index + 1) }, '›');
  const navLast = el('button', { class: 'nav-btn', 'aria-label': 'Last move', onclick: () => goTo(line.list.length) }, '»');
  const navRow = el('div', { class: 'nav-row-controls' }, navFirst, navPrev, navNext, navLast);

  // ---- setup and tools -----------------------------------------------------
  const editButton = el('button', { class: 'edit-toggle', onclick: () => setEditMode(!editMode) }, 'Edit position');
  const flipButton = el('button', { onclick: () => board.setOrientation(board.orientation === 'w' ? 'b' : 'w') }, 'Flip');
  const resetButton = el('button', { onclick: () => loadFenString(START_FEN) }, 'Start');
  const clearButton = el('button', { onclick: () => loadFenString(EMPTY_FEN, true) }, 'Clear');
  const copyButton = el('button', { onclick: () => void copyFen() }, 'Copy FEN');
  const fenInput = el('input', { type: 'text', placeholder: 'Paste a FEN to explore…' }) as HTMLInputElement;
  const loadButton = el('button', { onclick: () => loadFen() }, 'Load FEN');

  container.append(
    el('div', { class: 'hero analysis-hero' },
      el('div', { class: 'brand' }, el('h1', {}, 'Analysis'))),
    el('div', { class: 'analysis-layout' },
      el('div', { class: 'analysis-stage' },
        boardHost,
        navRow,
        pockets,
        editBar,
        statusLine),
      el('aside', { class: 'analysis-side' },
        el('section', { class: 'engine-panel' }, engineHead, linesList),
        el('section', { class: 'moves-panel' }, moveList),
        el('div', { class: 'btn-row' }, editButton, flipButton, resetButton, clearButton),
        el('details', { class: 'tools' },
          el('summary', {}, 'Load or copy a position'),
          el('div', { class: 'row' }, fenInput, loadButton),
          el('div', { class: 'btn-row' }, copyButton, turnButton)),
        el('p', { class: 'tiny analysis-help' },
          'Click a move to step to it, or use ← → (Home / End). Click an engine line to play it. ' +
          'Edit position starts a new line: tap a pocket piece, then tap squares; drag pieces to move, ' +
          'drag off the board to delete.'))));

  container.addEventListener('screen-dispose', () => {
    disposed = true;
    generation++;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('editing');
    engine.cancelSearch();
  }, { once: true });
  document.addEventListener('keydown', onKey);

  function onKey(e: KeyboardEvent): void {
    if (disposed || editMode) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    let next: number;
    if (e.key === 'ArrowLeft') next = line.index - 1;
    else if (e.key === 'ArrowRight') next = line.index + 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = line.list.length;
    else return;
    e.preventDefault();
    goTo(next);
  }

  function renderPockets(): void {
    pockets.replaceChildren();
    for (const color of ['w', 'b'] as const) {
      const row = el('div', { class: `pocket-row pocket-${color}` });
      for (const type of TRAY_PIECES) {
        const key = `${color}${type}`;
        const btn = el('button', { class: 'pocket-piece', 'aria-label': `${color === 'w' ? 'White' : 'Black'} ${type}` });
        btn.appendChild(pieceImg(type, color));
        const piece = { color, type };
        btn.addEventListener('click', () => {
          brush = piece;
          syncPocketSelection();
        });
        // Press arms the tool AND starts a drag: pull the piece straight onto
        // the board, or release in place to just arm it for tap-to-place.
        btn.addEventListener('pointerdown', (e) => startPocketDrag(e as PointerEvent, piece));
        pocketBtns[key] = btn;
        row.appendChild(btn);
      }
      pockets.appendChild(row);
    }
    const clearBtn = el('button', { class: 'pocket-clear', 'aria-label': 'Clear tool — tap pieces to delete' }, 'Clear');
    clearBtn.addEventListener('click', () => {
      brush = 'trash';
      syncPocketSelection();
    });
    pocketBtns.trash = clearBtn;
    pockets.appendChild(clearBtn);
    syncPocketSelection();
  }

  /** Press on a pocket piece: arm it, and if the press becomes a drag, carry
   * the piece onto the board (drop = place). Release in place = just armed. */
  function startPocketDrag(e: PointerEvent, piece: { color: Color; type: string }): void {
    if (document.body.classList.contains('dragging-piece')) return;
    brush = piece;
    syncPocketSelection();
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;
    const onMove = (ev: PointerEvent): void => {
      if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      if (!ghost) {
        ghost = el('div', { class: 'drag-ghost' });
        ghost.appendChild(pieceImg(piece.type, piece.color));
        document.body.appendChild(ghost);
        document.body.classList.add('dragging-piece');
      }
      positionGhost(ghost, ev.clientX, ev.clientY);
      const sq = boardSquareFromPoint(ev.clientX, ev.clientY);
      highlightDropTarget(sq);
      if (ev.cancelable) ev.preventDefault();
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('dragging-piece');
      if (!ghost) return; // press without drag: the click event arms the tool
      ghost.remove();
      ghost = null;
      const sq = boardSquareFromPoint(ev.clientX, ev.clientY);
      if (sq) {
        brush = piece;
        placePiece(piece, sq);
      }
    };
    const onCancel = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('dragging-piece');
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function positionGhost(ghost: HTMLElement, x: number, y: number): void {
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  }

  function boardSquareFromPoint(x: number, y: number): string | null {
    const rect = board.el.getBoundingClientRect();
    const size = rect.width;
    const col = Math.floor(((x - rect.left) / size) * 8);
    const row = Math.floor(((y - rect.top) / size) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return boardSquareAt(row, col, board.orientation);
  }

  function highlightDropTarget(sq: string | null): void {
    for (const cell of board.el.querySelectorAll('.square')) {
      cell.classList.remove('over');
    }
    if (sq) board.el.querySelector(`.square[data-sq="${sq}"]`)?.classList.add('over');
  }

  function syncPocketSelection(): void {
    for (const [key, btn] of Object.entries(pocketBtns)) {
      const active =
        (brush === 'trash' && key === 'trash') ||
        (brush !== null && brush !== 'trash' && key === `${brush.color}${brush.type}`);
      btn.classList.toggle('active', active);
    }
  }

  function renderEditBar(): void {
    editBar.replaceChildren(
      el('span', { class: 'edit-hint' }, 'Tap board to place · drag to move · drag off to remove'),
      el('span', { class: 'edit-controls' }, castlingButton, epButton, turnButton, editCopyButton));
  }

  function setEditMode(on: boolean): void {
    editMode = on;
    // Flag lets CSS shrink the board so pockets + edit bar still fit one screen.
    document.body.classList.toggle('editing', on);
    board.setEditMode(on);
    editButton.classList.toggle('active', on);
    pockets.style.display = on ? 'grid' : 'none';
    editBar.style.display = on ? 'flex' : 'none';
    if (on) {
      if (!brush) brush = { color: 'w', type: 'p' };
      renderPockets();
      renderEditBar();
      syncEditChips();
    }
  }

  function syncEditChips(): void {
    const parts = game.fen().split(' ');
    const castles = parts[2];
    castlingButton.classList.toggle('on', castles !== '-');
    epButton.classList.toggle('on', parts[3] !== '-');
    const white = game.turn() === 'w';
    turnButton.textContent = white ? 'White to move' : 'Black to move';
    turnButton.classList.toggle('on', white);
  }

  /** Setup edits (castling, en passant, turn, pieces) make the edited position
   * the root of a new line, so the move list always starts from a real board. */
  function commitSetup(): void {
    line.reset(game.fen());
    showCurrent(false, null);
  }

  function toggleCastling(): void {
    const parts = game.fen().split(' ');
    parts[2] = parts[2] === '-' ? 'KQkq' : '-';
    game.load(parts.join(' '));
    commitSetup();
  }

  function toggleEnPassant(): void {
    const parts = game.fen().split(' ');
    if (parts[3] !== '-') {
      parts[3] = '-';
    } else {
      const ep = plausibleEpSquare(game.turn());
      if (!ep) {
        toast('Line up a pawn next to an enemy pawn (rank 4/5) to enable en passant.');
        return;
      }
      parts[3] = ep;
    }
    game.load(parts.join(' '));
    commitSetup();
  }

  /** A plausible en-passant target for `turn`: an enemy pawn that could have
   * just double-pushed, with one of our pawns beside it. */
  function plausibleEpSquare(turn: Color): string | null {
    const rows = game.board();
    // White to move: black pawn on rank 5 (row idx 3) beside a white pawn.
    const rowIdx = turn === 'w' ? 3 : 4;
    const epRank = turn === 'w' ? '6' : '3';
    const row = rows[rowIdx];
    if (!row) return null;
    const enemy = turn === 'w' ? 'b' : 'w';
    for (let f = 0; f < 8; f++) {
      const sq = row[f];
      if (!sq || sq.color !== enemy || sq.type !== 'p') continue;
      const left = f > 0 ? row[f - 1] : null;
      const right = f < 7 ? row[f + 1] : null;
      const beside = [left, right].some((p) => p && p.color === turn && p.type === 'p');
      if (beside) return `${FILES_BY_INDEX[f]}${epRank}`;
    }
    return null;
  }

  function toggleTurn(): void {
    swapTurn(game.turn() === 'w' ? 'b' : 'w');
  }

  /** Editor actions from the Board: taps place the brush, drags relocate,
   * tap-with-trash or drag-off-board removes, contextmenu clears the square. */
  function handleEdit(action: { type: 'tap' | 'move' | 'remove' | 'clear'; from?: string; to?: string }): void {
    if (action.type === 'move' && action.from && action.to) {
      relocate(action.from, action.to);
      return;
    }
    if (action.type === 'remove' && action.from) {
      removeAt(action.from);
      return;
    }
    if (action.type === 'clear' && action.from) {
      clearAt(action.from);
      return;
    }
    if (action.type === 'tap' && action.to) {
      if (brush === 'trash') {
        removeAt(action.to);
        return;
      }
      if (!brush) return;
      // Same piece tapped again toggles it off — quick delete gesture.
      const existing = game.get(action.to as never);
      if (existing && existing.color === brush.color && existing.type === brush.type) {
        removeAt(action.to);
        return;
      }
      placePiece(brush, action.to);
    }
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
    const candidate = `${rows.join('/')} ${parts[1]} ${parts[2]} ${parts[3]} 0 1`;
    const snapshot = game.fen();
    try {
      game.load(candidate);
    } catch {
      game.load(snapshot); // not a loadable position; keep the old one
      return false;
    }
    line.reset(game.fen());
    showCurrent(false, lastMove ?? null);
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

  function editRejected(): void {
    toast('Position not loadable (needs both kings, legal checks).');
  }

  function placePiece(piece: { color: Color; type: string }, to: string): void {
    const pieces = boardMap();
    pieces[to] = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    if (!applyPieces(pieces)) editRejected();
  }

  function removeAt(from: string): void {
    if (!game.get(from as never)) return;
    const pieces = boardMap();
    delete pieces[from];
    if (!applyPieces(pieces)) editRejected();
  }

  /** Unconditional removal (contextmenu / trash drag target). */
  function clearAt(from: string): void {
    if (!game.get(from as never)) return;
    removeAt(from);
  }

  function relocate(from: string, to: string): void {
    const pieces = boardMap();
    const moved = pieces[from];
    if (!moved) return;
    delete pieces[from];
    pieces[to] = moved;
    if (!applyPieces(pieces, { from, to })) editRejected();
  }

  /** Play a UCI move from the current position, recording it on the line. */
  function playUci(uci: string): boolean {
    const played = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] ?? 'q',
    });
    if (!played) return false;
    line.push({
      san: played.san,
      uci: `${played.from}${played.to}${played.promotion ?? ''}`,
      fen: game.fen(),
    });
    showCurrent(true);
    return true;
  }

  function goTo(index: number): void {
    if (line.goTo(index)) showCurrent(false);
  }

  /** Load the line's current position into the board and refresh the panels. */
  function showCurrent(sound: boolean, lastMove: { from: string; to: string } | null | undefined = undefined): void {
    game.load(line.currentFen());
    board.setLastMove(lastMove === undefined ? line.lastMove() : lastMove);
    board.setHints([]);
    board.render();
    if (sound) play('move');
    renderMoves();
    navFirst.disabled = line.index === 0;
    navPrev.disabled = line.index === 0;
    navNext.disabled = line.index === line.list.length;
    navLast.disabled = line.index === line.list.length;
    if (editMode) syncEditChips();
    scheduleAnalysis();
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
    if (keepTurn) {
      const turn = game.turn();
      game.load(fen.replace(/\s[wb]\s/, ` ${turn} `));
    } else {
      game.load(fen);
    }
    board.setOrientation(game.turn());
    commitSetup();
  }

  async function copyFen(): Promise<void> {
    try {
      await navigator.clipboard.writeText(game.fen());
      toast('FEN copied.');
    } catch {
      toast('Could not access the clipboard.');
    }
  }

  function swapTurn(turn: Color): void {
    const parts = game.fen().split(' ');
    parts[1] = turn;
    // Manual edits: clear en passant, reset the halfmove/fullmove counters.
    parts[3] = '-';
    parts[4] = '0';
    parts[5] = '1';
    game.load(parts.join(' '));
    commitSetup();
  }

  function renderMoves(): void {
    const moves = line.list;
    moveList.replaceChildren();
    if (moves.length === 0) {
      moveList.append(el('span', { class: 'muted' }, 'No moves yet. Play a move on the board.'));
      return;
    }
    const plyButton = (index: number): HTMLButtonElement => {
      const current = line.index === index + 1;
      const btn = el('button', {
        class: current ? 'ply current' : 'ply',
        'aria-current': current ? 'step' : 'false',
        onclick: () => goTo(index + 1),
      }, moves[index].san) as HTMLButtonElement;
      return btn;
    };
    for (let i = 0; i < moves.length; i += 2) {
      const row = el('div', { class: 'move-row' }, el('span', { class: 'num' }, `${i / 2 + 1}.`));
      row.append(plyButton(i));
      if (i + 1 < moves.length) row.append(plyButton(i + 1));
      moveList.append(row);
    }
    moveList.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  function scheduleAnalysis(): void {
    const myGeneration = ++generation;
    // A search for the previous position must end before a new one starts.
    engine.cancelSearch();
    engineLines = new Map();
    engineFen = game.fen();
    infoText = '';
    renderLines();
    evalLabel.textContent = '…';
    void runAnalysis(myGeneration);
  }

  async function runAnalysis(myGeneration: number): Promise<void> {
    if (disposed || myGeneration !== generation) return;
    const counts = countPieces(game);
    if (counts.w.k === 0 || counts.b.k === 0) {
      setInfo('Add both kings to analyze this position.');
      return;
    }
    if (game.isGameOver()) {
      setInfo(game.isCheckmate() ? 'Checkmate.' : 'Draw.');
      return;
    }
    setInfo('Thinking…');
    try {
      await engine.init('lite');
    } catch {
      setStatus('Engine unavailable — the board still works.');
      setInfo('Engine unavailable.');
      return;
    }
    if (disposed || myGeneration !== generation) return;
    const fen = game.fen();
    try {
      await engine.analyse(fen, THINK_MS, (cp, mate, pv, depth, multipv) => {
        if (disposed || myGeneration !== generation) return;
        engineLines.set(multipv, { multipv, cp, mate, pv, depth });
        renderLines();
      }, ENGINE_LINES);
      if (!disposed && myGeneration === generation) setStatus('');
    } catch {
      if (!disposed && myGeneration === generation) setStatus('Engine unavailable — the board still works.');
    }
  }

  /** Redraw the engine panel, the eval bar, and the best-move hint from the
   * latest engine output for `engineFen`. */
  function renderLines(): void {
    const rows = [...engineLines.values()]
      .filter((info) => info.pv.length > 0)
      .sort((a, b) => a.multipv - b.multipv);
    const top = rows[0];
    const sideSign = engineFen.split(' ')[1] === 'b' ? -1 : 1;
    linesList.replaceChildren();
    if (!top) {
      linesList.append(el('div', { class: 'muted' }, infoText || 'Waiting for the engine…'));
    } else {
      engineHead.textContent = `Stockfish Lite · depth ${top.depth}`;
      for (const info of rows) {
        const whiteCp = info.cp === null ? null : info.cp * sideSign;
        const whiteMate = info.mate === null ? null : info.mate * sideSign;
        const button = el('button', {
          class: 'engine-line',
          title: 'Play this line',
          onclick: () => playEngineLine(info),
        },
          el('span', { class: 'eval-chip' }, formatEval(whiteCp, whiteMate)),
          el('span', { class: 'pv' }, pvToSan(engineFen, info.pv)));
        button.disabled = engineFen !== game.fen();
        linesList.append(button);
      }
    }

    if (top) {
      const whiteCp = top.cp === null ? null : top.cp * sideSign;
      const whiteMate = top.mate === null ? null : top.mate * sideSign;
      evalFill.style.height = `${evalFraction(whiteCp, whiteMate) * 100}%`;
      evalLabel.textContent = formatEval(whiteCp, whiteMate);
      const hint = top.pv[0];
      board.setHints(engineFen === game.fen() && hint
        ? [{ from: hint.slice(0, 2), to: hint.slice(2, 4) }]
        : []);
    }
  }

  function playEngineLine(info: EngineInfo): void {
    if (engineFen !== game.fen() || !info.pv[0]) return;
    playUci(info.pv[0]);
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
    for (const uci of pv.slice(0, PV_PLIES)) {
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

  function setInfo(text: string): void {
    infoText = text;
    renderLines();
  }

  // ---------- boot ----------
  setEditMode(false);
  showCurrent(false);
}
