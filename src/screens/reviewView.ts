/**
 * Deep review screen (bottom sheet): eval graph with tap-to-replay,
 * both players' accuracy, phase breakdown, critical moments, per-ply list.
 * Analyses are persisted per game — reopening is instant.
 */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { deepReview, type DeepReview, type PlyReview } from '../review';
import { CLS_COLORS, CLS_ORDER } from '../reviewScoring';
import { el, modal } from '../ui';
import { saveReview, getReview } from '../db';
import type { GameRecord } from '../types';

export async function openReview(rec: GameRecord): Promise<void> {
  // Instant path: previously analysed.
  const cached = await getReview(rec.ts).catch(() => null);
  if (cached) {
    renderReview(rec, cached as DeepReview);
    return;
  }
  const bar = el('div', { class: 'progress' }, el('div', {}));
  const status = el('p', { class: 'muted' }, 'Preparing analysis…');
  const closeSheet = modal(
    el('h2', {}, 'Game review'),
    bar,
    status
  );
  void (async () => {
    try {
      const { engine } = await import('../engineClient');
      await engine.init('lite', () => {});
      const review = await deepReview(rec, (done, total, label) => {
        (bar.firstChild as HTMLElement).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
        status.textContent = `${label}…`;
      });
      await saveReview(rec.ts, review).catch(() => {});
      closeSheet();
      renderReview(rec, review);
    } catch (e) {
      status.textContent = `Review failed: ${(e as Error).message}`;
      (bar.firstChild as HTMLElement).style.width = '0%';
    }
  })();
}

function renderReview(rec: GameRecord, review: DeepReview): void {
  const playerCard = rec.color === 'w' ? review.white : review.black;
  const oppCard = rec.color === 'w' ? review.black : review.white;

  const content = el('div', { class: 'review' });

  // ---- Replay board (hidden until a ply is selected) ----
  const replayHost = el('div', { class: 'board-wrap' });
  const replayGame = new Chess(rec.startFen);
  const board = new Board(replayHost, replayGame, {
    orientation: rec.color,
    interactive: false,
    onMove: () => {},
  });
  const replayCaption = el('p', { class: 'muted center', style: 'margin:4px 0' }, '');
  const bestBadge = el('div', { class: 'center', style: 'min-height:30px' });

  function showPly(ply: number, highlightBest = false): void {
    const g = new Chess(rec.startFen);
    const uciList = rec.movesUci.trim().split(/\s+/).filter(Boolean);
    let last: { from: string; to: string } | null = null;
    for (let i = 0; i < ply && i < uciList.length; i++) {
      const u = uciList[i];
      g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      last = { from: u.slice(0, 2), to: u.slice(2, 4) };
    }
    replayGame.load(g.fen());
    board.setLastMove(last);
    board.render();
    const pr = ply >= 1 && ply <= review.plies.length ? review.plies[ply - 1] : null;
    if (pr) {
      const col = CLS_COLORS[pr.cls];
      replayCaption.innerHTML = '';
      replayCaption.append(
        el('span', { style: `color:${col};font-weight:700` }, `${Math.ceil(pr.ply / 2)}${pr.ply % 2 ? '.' : '…'} ${pr.san} — ${pr.book ? 'book move' : pr.cls}`),
        pr.book ? '' : ` · drop ${pr.winDrop.toFixed(1)}% · best ${pr.bestSan}`
      );
    } else {
      replayCaption.textContent = 'Starting position';
    }
    bestBadge.innerHTML = '';
    if (highlightBest && pr && pr.bestUci) {
      bestBadge.append(
        el('button', { class: 'small', onclick: () => showPly(pr.ply - 1, false) },
          `◀ see position before`)
      );
    }
  }

  // ---- Eval graph (SVG) ----
  const graph = buildEvalGraph(review, (ply) => showPly(ply, true));

  // ---- Summary cards ----
  const you = playerSummary(playerCard, 'You');
  const them = playerSummary(oppCard, 'CPU');

  // ---- Phase breakdown ----
  const phases = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'By phase'),
    ...playerCard.phases.filter(p => p.moves > 0).map(p =>
      el('div', { class: 'list-tile' },
        el('span', {}, p.name.charAt(0).toUpperCase() + p.name.slice(1)),
        el('b', { style: 'font-family:var(--serif)' }, `${Math.round(p.accuracy)}%`)) as Node)
  );

  // ---- Critical moments ----
  const moments = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Turning points'),
    ...(review.criticalMoments.length === 0
      ? [el('p', { class: 'muted' }, 'None — steady game.') as Node]
      : review.criticalMoments.map(m => momentTile(m, () => showPly(m.ply, true)) as Node))
  );

  // ---- Full move list ----
  const list = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Moves'),
    el('div', { class: 'review-list' },
      ...review.plies.map(pr => plyTile(pr, () => showPly(pr.ply, true)) as Node))
  );

  content.append(
    graph,
    el('div', { class: 'section' },
      el('p', { class: 'kicker' }, 'Replay'),
      replayHost,
      replayCaption,
      bestBadge),
    you,
    them,
    phases,
    moments,
    list
  );

  modal(
    el('h2', { style: 'font-size:1.25rem' }, 'Review'),
    el('p', { class: 'kicker' }, review.openingLabel),
    content
  );
  showPly(0);
}

function buildEvalGraph(review: DeepReview, onTap: (ply: number) => void): HTMLElement {
  const W = 320;
  const H = 90;
  const pts = review.evalGraph;
  const maxAbs = Math.max(300, ...pts.map(p => Math.abs(p.cp)));
  const toY = (cp: number) => H / 2 - (cp / maxAbs) * (H / 2 - 6);
  const toX = (ply: number) => (ply / Math.max(1, pts.length - 1)) * (W - 8) + 4;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'evalgraph');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  // white/black fill areas
  const whiteArea = document.createElementNS(svgNS, 'path');
  const blackArea = document.createElementNS(svgNS, 'path');
  let up = `M ${toX(0)} ${H / 2}`;
  let down = `M ${toX(0)} ${H / 2}`;
  for (const p of pts) {
    const x = toX(p.ply);
    const y = toY(p.cp);
    up += ` L ${x} ${y}`;
    down += ` L ${x} ${y}`;
  }
  up += ` L ${toX(pts[pts.length - 1]?.ply ?? 0)} ${H / 2} Z`;
  down += ` L ${toX(pts[pts.length - 1]?.ply ?? 0)} ${H / 2} Z`;
  whiteArea.setAttribute('d', up);
  whiteArea.setAttribute('fill', 'rgba(255,255,255,0.75)');
  blackArea.setAttribute('d', down);
  blackArea.setAttribute('fill', 'rgba(30,30,30,0.75)');
  svg.append(blackArea, whiteArea);

  // invisible tap columns per ply
  for (let i = 0; i < pts.length; i++) {
    const x0 = toX(i) - (W / pts.length) / 2;
    const w = W / pts.length;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(Math.max(0, x0)));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(H));
    rect.setAttribute('fill', 'transparent');
    const ply = pts[i].ply;
    rect.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onTap(ply);
    });
    svg.append(rect);
  }

  const wrap = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Eval — tap to jump'),
    svg);
  return wrap;
}

function playerSummary(p: DeepReview['white'], label: string): HTMLElement {
  const counts = CLS_ORDER.filter(c => p.counts[c] > 0).map(cls =>
    el('span', { class: 'chip', style: `border-color:${CLS_COLORS[cls]};color:${CLS_COLORS[cls]}` },
      `${p.counts[cls]} ${cls}`)
  );
  return el('div', { class: 'section' },
    el('div', { class: 'row' },
      el('span', { class: 'kicker', style: 'margin:0' }, label),
      el('b', { style: `font-size:1.35rem;font-family:var(--serif)` }, `${Math.round(p.accuracy)}%`)),
    el('div', { class: 'puzzle-meta', style: 'margin:4px 0 0' }, ...counts),
    p.worst && p.worst.winDrop > 12
      ? el('p', { class: 'tiny', style: 'margin:6px 0 0' },
          `Worst: ${Math.ceil(p.worst.ply / 2)}${p.worst.ply % 2 ? '.' : '…'} ${p.worst.san} → ${p.worst.bestSan}`)
      : null
  );
}

function momentTile(m: PlyReview, onTap: () => void): HTMLElement {
  const col = CLS_COLORS[m.cls];
  const swing = m.evalAfterCp - m.evalBeforeCp;
  const who = m.moverIsWhite ? 'White' : 'Black';
  return el('button', { class: 'moment-tile', onclick: onTap },
    el('span', { style: `color:${col};font-weight:700` }, `${Math.ceil(m.ply / 2)}${m.ply % 2 ? '.' : '…'} ${m.san}`),
    el('span', { class: 'muted' }, `${who} · swing ${(swing / 100).toFixed(1)} pawns`),
    el('span', { class: 'muted' }, `best: ${m.bestSan}`)
  );
}

function plyTile(pr: PlyReview, onTap: () => void): HTMLElement {
  const col = CLS_COLORS[pr.cls];
  return el('button', { class: 'ply-tile', onclick: onTap },
    el('span', { class: 'num' }, `${Math.ceil(pr.ply / 2)}${pr.ply % 2 ? '.' : '…'}`),
    el('span', { style: `color:${col};font-weight:700;min-width:64px` }, pr.san),
    el('span', { class: 'muted', style: 'flex:1;text-align:left' }, pr.book ? 'book' : pr.cls),
    el('span', { class: 'muted' }, pr.book ? '—' : `${pr.winDrop.toFixed(0)}%`)
  );
}
