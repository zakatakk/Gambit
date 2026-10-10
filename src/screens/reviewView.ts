/**
 * Deep review screen (bottom sheet): eval graph with tap-to-replay,
 * both players' accuracy, phase breakdown, critical moments, per-ply list.
 * Analyses are persisted per game — reopening is instant.
 */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { seekState } from '../analysisLine';
import { deepReview, type DeepReview, type PlyReview } from '../review';
import { engine } from '../engineClient';
import { CLS_COLORS, CLS_ORDER, mateScoreValue, winPct } from '../reviewScoring';
import { el, modal } from '../ui';
import { saveReview, getReview, getSettings } from '../db';
import { applyBoardTheme, applyPieceSet } from '../pieces';
import type { GameRecord } from '../types';

export async function openReview(rec: GameRecord, isCurrent: () => boolean = () => true): Promise<void> {
  const [cached, appearance] = await Promise.all([
    getReview(rec.ts).catch(() => null),
    getSettings(),
  ]);
  if (!isCurrent()) return;
  applyPieceSet(appearance.pieceSet);
  applyBoardTheme(appearance.boardTheme);
  if (cached) {
    renderReview(rec, cached as DeepReview, appearance.showCoords);
    return;
  }

  const bar = el('div', { class: 'progress' }, el('div', {}));
  const status = el('p', { class: 'muted' }, 'Preparing analysis…');
  const retry = el('button', {
    class: 'small',
    style: 'display:none',
    onclick: () => void runReview(),
  }, 'Retry analysis');
  const closeSheet = modal(el('h2', {}, 'Game review'), bar, status, retry);

  async function runReview(): Promise<void> {
    retry.style.display = 'none';
    (bar.firstElementChild as HTMLElement).style.width = '0%';
    status.textContent = 'Preparing analysis…';
    try {
      await engine.init('lite', () => {});
      if (!isCurrent()) return;
      const review = await deepReview(rec, (done, total, label) => {
        if (!isCurrent()) return;
        (bar.firstElementChild as HTMLElement).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
        status.textContent = label;
      });
      if (!isCurrent()) return;
      await saveReview(rec.ts, review).catch(() => {});
      if (!isCurrent()) return;
      closeSheet();
      renderReview(rec, review, appearance.showCoords);
    } catch (error) {
      if (!isCurrent()) return;
      status.textContent = `Review failed: ${(error as Error).message}`;
      retry.style.display = '';
    }
  }

  void runReview();
}

function renderReview(rec: GameRecord, review: DeepReview, showCoords = true): void {
  document.querySelectorAll('.modal-back').forEach((modal) => modal.remove());

  const playerCard = rec.color === 'w' ? review.white : review.black;
  const oppCard = rec.color === 'w' ? review.black : review.white;
  const content = el('div', { class: 'review' });
  const replayHost = el('div', { class: 'board-wrap' });
  const replayCaption = el('p', { class: 'muted center', style: 'margin:4px 0' }, '');
  const bestBadge = el('div', { class: 'center', style: 'min-height:30px' });
  const replayGame = new Chess(rec.startFen);
  const replayMoves = rec.movesUci.trim().split(/\s+/).filter(Boolean).slice(0, review.plies.length);
  const replayStartFen = replayGame.fen();
  const board = new Board(replayHost, replayGame, {
    orientation: rec.color,
    interactive: false,
    showCoords,
    onMove: () => {},
  });
  let shownPly = 0;

  // ---- replay scrubber: step a ply at a time, or drag to any position ----
  const seekInput = el('input', {
    type: 'range',
    class: 'seek-range',
    min: '0',
    max: String(replayMoves.length),
    step: '1',
    value: '0',
    'aria-label': 'Seek to move',
  });
  const seekLabel = el('span', { class: 'seek-label', 'aria-hidden': 'true' }, `0/${replayMoves.length}`);
  const navFirst = el('button', { class: 'nav-btn', 'aria-label': 'First move', onclick: () => showPly(0) }, '«');
  const navPrev = el('button', { class: 'nav-btn', 'aria-label': 'Previous move', onclick: () => showPly(shownPly - 1) }, '‹');
  const navNext = el('button', { class: 'nav-btn', 'aria-label': 'Next move', onclick: () => showPly(shownPly + 1) }, '›');
  const navLast = el('button', { class: 'nav-btn', 'aria-label': 'Last move', onclick: () => showPly(replayMoves.length) }, '»');
  const seekControls = el('div', { class: 'replay-seek' },
    el('div', { class: 'nav-row-controls' }, navFirst, navPrev, navNext, navLast),
    el('div', { class: 'seek-bar' }, seekInput, seekLabel));
  seekInput.addEventListener('input', () => showPly(Number(seekInput.value)));

  function showPly(ply: number, highlightBest = false): void {
    const targetPly = Math.max(0, Math.min(ply, replayMoves.length));
    if (targetPly < shownPly) {
      replayGame.reset();
      replayGame.load(replayStartFen);
      shownPly = 0;
    }
    while (shownPly < targetPly) {
      const uci = replayMoves[shownPly];
      const move = replayGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!move) break;
      shownPly++;
    }

    const lastUci = shownPly > 0 ? replayMoves[shownPly - 1] : undefined;
    board.setLastMove(lastUci ? { from: lastUci.slice(0, 2), to: lastUci.slice(2, 4) } : null);
    board.render();

    const reviewedPly = shownPly >= 1 && shownPly <= review.plies.length ? review.plies[shownPly - 1] : null;
    replayCaption.replaceChildren();
    if (reviewedPly) {
      const color = CLS_COLORS[reviewedPly.cls];
      replayCaption.append(
        el('span', { style: `color:${color};font-weight:700` },
          `${Math.ceil(reviewedPly.ply / 2)}${reviewedPly.ply % 2 ? '.' : '…'} ${reviewedPly.san} — ${reviewedPly.book ? 'book move' : reviewedPly.cls}`),
        reviewedPly.book ? '' : ` · drop ${reviewedPly.winDrop.toFixed(1)}% · best ${reviewedPly.bestSan}`
      );
    } else {
      replayCaption.textContent = 'Starting position';
    }

    bestBadge.replaceChildren();
    if (highlightBest && reviewedPly?.bestUci) {
      bestBadge.append(el('button', {
        class: 'small',
        onclick: () => showPly(reviewedPly.ply - 1),
      }, 'See position before'));
    }

    // Keep the scrubber and its step buttons in step with the board: taps on
    // the graph or the move list move the slider too.
    const seek = seekState(review.plies, shownPly);
    seekInput.value = String(seek.value);
    seekInput.disabled = seek.max === 0;
    seekInput.setAttribute('aria-valuetext', seek.valueText);
    seekLabel.textContent = seek.label;
    navFirst.disabled = shownPly === 0;
    navPrev.disabled = shownPly === 0;
    navNext.disabled = shownPly >= replayMoves.length;
    navLast.disabled = shownPly >= replayMoves.length;
  }

  const graph = buildEvalGraph(review, (ply) => showPly(ply, true));
  const you = playerSummary(playerCard, 'You');
  const them = playerSummary(oppCard, 'CPU');
  const phases = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'By phase'),
    ...playerCard.phases.filter((phase) => phase.moves > 0).map((phase) =>
      el('div', { class: 'list-tile' },
        el('span', {}, phase.name.charAt(0).toUpperCase() + phase.name.slice(1)),
        el('b', { style: 'font-family:var(--serif)' }, `${Math.round(phase.accuracy)}%`)))
  );
  const moments = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Turning points'),
    ...(review.criticalMoments.length === 0
      ? [el('p', { class: 'muted' }, 'None — steady game.')]
      : review.criticalMoments.map((move) => momentTile(move, () => showPly(move.ply, true))))
  );
  const list = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Moves'),
    el('div', { class: 'review-list' },
      ...review.plies.map((move) => plyTile(move, () => showPly(move.ply, true))))
  );

  content.append(
    graph,
    el('div', { class: 'section' }, el('p', { class: 'kicker' }, 'Replay'), replayHost, seekControls, replayCaption, bestBadge),
    you,
    them,
    phases,
    moments,
    list
  );
  modal(el('h2', { style: 'font-size:1.25rem' }, 'Review'),
    el('p', { class: 'kicker' }, review.openingLabel), content);
  showPly(0);
}

function buildEvalGraph(review: DeepReview, onTap: (ply: number) => void): HTMLElement {
  const width = 320;
  const height = 90;
  const points = review.evalGraph;
  const maxAbs = Math.max(300, ...points.map((point) => Math.abs(point.cp)));
  const toY = (cp: number) => height / 2 - (cp / maxAbs) * (height / 2 - 6);
  const toX = (ply: number) => (ply / Math.max(1, points.length - 1)) * (width - 8) + 4;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'evalgraph');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const whiteArea = document.createElementNS(svgNS, 'path');
  const blackArea = document.createElementNS(svgNS, 'path');
  let areaPath = `M ${toX(0)} ${height / 2}`;
  for (const point of points) areaPath += ` L ${toX(point.ply)} ${toY(point.cp)}`;
  areaPath += ` L ${toX(points[points.length - 1]?.ply ?? 0)} ${height / 2} Z`;
  whiteArea.setAttribute('d', areaPath);
  whiteArea.setAttribute('fill', 'rgba(255,255,255,0.75)');
  blackArea.setAttribute('d', areaPath);
  blackArea.setAttribute('fill', 'rgba(30,30,30,0.75)');
  svg.append(blackArea, whiteArea);

  const columnWidth = width / Math.max(1, points.length);
  for (const point of points) {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(Math.max(0, toX(point.ply) - columnWidth / 2)));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(columnWidth));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', 'transparent');
    rect.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      onTap(point.ply);
    });
    svg.append(rect);
  }

  return el('div', { class: 'section' }, el('p', { class: 'kicker' }, 'Eval — tap to jump'), svg);
}

function playerSummary(player: DeepReview['white'], label: string): HTMLElement {
  const counts = CLS_ORDER.filter((cls) => player.counts[cls] > 0).map((cls) =>
    el('span', { class: 'chip', style: `border-color:${CLS_COLORS[cls]};color:${CLS_COLORS[cls]}` },
      `${player.counts[cls]} ${cls}`));
  return el('div', { class: 'section' },
    el('div', { class: 'row' },
      el('span', { class: 'kicker', style: 'margin:0' }, label),
      el('b', { style: 'font-size:1.35rem;font-family:var(--serif)' }, `${Math.round(player.accuracy)}%`)),
    el('div', { class: 'puzzle-meta', style: 'margin:4px 0 0' }, ...counts),
    player.worst && player.worst.winDrop > 12
      ? el('p', { class: 'tiny', style: 'margin:6px 0 0' },
          `Worst: ${Math.ceil(player.worst.ply / 2)}${player.worst.ply % 2 ? '.' : '…'} ${player.worst.san} → ${player.worst.bestSan}`)
      : null
  );
}

function momentTile(move: PlyReview, onTap: () => void): HTMLElement {
  const color = CLS_COLORS[move.cls];
  const beforeWhite = move.evalBeforeMate === null
    ? winPct(move.evalBeforeCp)
    : mateScoreValue(move.evalBeforeMate);
  const afterWhite = move.evalAfterMate === null
    ? winPct(move.evalAfterCp)
    : mateScoreValue(move.evalAfterMate);
  const swing = move.moverIsWhite ? afterWhite - beforeWhite : beforeWhite - afterWhite;
  const who = move.moverIsWhite ? 'White' : 'Black';
  return el('button', { class: 'moment-tile', onclick: onTap },
    el('span', { style: `color:${color};font-weight:700` },
      `${Math.ceil(move.ply / 2)}${move.ply % 2 ? '.' : '…'} ${move.san}`),
    el('span', { class: 'muted' }, `${who} · ${swing >= 0 ? '+' : ''}${swing.toFixed(1)} win%`),
    el('span', { class: 'muted' }, `best: ${move.bestSan}`));
}

function plyTile(move: PlyReview, onTap: () => void): HTMLElement {
  const color = CLS_COLORS[move.cls];
  return el('button', { class: 'ply-tile', onclick: onTap },
    el('span', { class: 'num' }, `${Math.ceil(move.ply / 2)}${move.ply % 2 ? '.' : '…'}`),
    el('span', { style: `color:${color};font-weight:700;min-width:64px` }, move.san),
    el('span', { class: 'muted', style: 'flex:1;text-align:left' }, move.book ? 'book' : move.cls),
    el('span', { class: 'muted' }, move.book ? '—' : `${move.winDrop.toFixed(0)}%`));
}
