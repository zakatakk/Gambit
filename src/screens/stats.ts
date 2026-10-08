/** Stats: rating history chart, game record, puzzle accuracy, openings, reviews, history. */
import { getHistory, recentGames, getAttempts, getProfile, reviewedGameTimestamps } from '../db';
import { el } from '../ui';
import { detectOpening, replayUci } from '../openings';
import { openReview } from './reviewView';
import type { App } from '../app';
import type { GameRecord } from '../types';

/** Most recent games shown in the compact history list. */
const HISTORY_LIMIT = 4;
/** Most recent reviewable games offered for analysis. */
const REVIEWS_LIMIT = 3;
/** Most played openings shown. */
const OPENINGS_LIMIT = 3;

export async function mountStats(container: HTMLElement, _app: App): Promise<void> {
  const [profile, history, games, attempts, reviewed] = await Promise.all([
    getProfile(),
    getHistory(200),
    recentGames(30),
    getAttempts(),
    reviewedGameTimestamps(),
  ]);
  if (!container.isConnected) return;

  const wins = games.filter((g) => g.result === 'win').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  const draws = games.filter((g) => g.result === 'draw').length;
  const solved = attempts.filter((a) => a.won).length;

  // Rating head: the big number doubles as the hero, sparkline underneath.
  const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spark.setAttribute('class', 'spark');
  spark.setAttribute('viewBox', '0 0 300 60');
  spark.setAttribute('preserveAspectRatio', 'none');
  if (history.length >= 2) {
    const rs = history.map((h) => h.rating);
    const min = Math.min(...rs) - 20;
    const max = Math.max(...rs) + 20;
    const pts = history
      .map((h, i) => {
        const x = (i / (history.length - 1)) * 296 + 2;
        const y = 58 - ((h.rating - min) / Math.max(1, max - min)) * 54;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    spark.appendChild(poly);
  }

  const head = el('div', { class: 'stats-head' },
    el('div', { class: 'hero stats-hero' },
      el('div', { class: 'brand' },
        el('h1', {}, 'Stats'),
        el('div', {},
          el('span', { class: 'rating-big' }, String(Math.round(profile.rating))),
          el('span', { class: 'rd-badge' }, `± ${Math.round(profile.rd)}`)))),
    spark);

  const recordCard = el('div', { class: 'stat-tile' },
    el('p', { class: 'kicker' }, 'Record'),
    statLine('CPU games', `${wins}W ${draws}D ${losses}L`),
    statLine('Puzzles solved', `${solved} / ${attempts.length}`),
    attempts.length ? statLine('Puzzle success', `${Math.round((solved / attempts.length) * 100)}%`) : null);

  // Openings are derived from recent games; computed after the DOM is in place
  // below so the screen paints immediately.
  const openingsCard = el('div', { class: 'stat-tile' },
    el('p', { class: 'kicker' }, 'Openings'),
    el('div', { class: 'stat-openings', 'aria-live': 'polite' },
      el('p', { class: 'muted', style: 'margin:2px 0' }, '…')));

  const reviewsCard = el('div', { class: 'stat-tile stat-tile-wide' },
    el('p', { class: 'kicker' }, 'Learn'),
    el('div', { class: 'stat-list' }));

  const historyCard = el('div', { class: 'stat-tile stat-tile-wide' },
    el('p', { class: 'kicker' }, 'Recent games'),
    el('div', { class: 'stat-list' }));

  container.append(head, el('div', { class: 'stats-grid' }, recordCard, openingsCard, reviewsCard, historyCard));

  // ---------- deferred data (openings detection + list tiles) ----------
  const reviewable = games.filter((g) => g.movesUci.trim().length > 0);
  const reviewsList = reviewsCard.querySelector('.stat-list') as HTMLElement;
  reviewsList.replaceChildren(
    ...(reviewable.length === 0
      ? [emptyNote('Play a game, then review it to learn from every move.')]
      : reviewable.slice(0, REVIEWS_LIMIT).map((g) => reviewTile(g, reviewed.has(g.ts)))));

  const historyList = historyCard.querySelector('.stat-list') as HTMLElement;
  historyList.replaceChildren(
    ...(games.length === 0
      ? [emptyNote('No games yet.')]
      : games.slice(0, HISTORY_LIMIT).map((g) =>
          el('div', { class: 'list-tile' },
            el('span', {},
              el('b', {}, g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'),
              gameListLabel(g)),
            el('span', { class: 'muted' },
              new Date(g.ts).toLocaleDateString(),
              g.ratingAfter ? ` · ${Math.round(g.ratingBefore ?? 0)}→${Math.round(g.ratingAfter)}` : '')))));

  // Openings detection replays up to 12 plies per game; keep it off the paint path.
  void Promise.resolve().then(() => {
    if (!container.isConnected) return;
    const openings = new Map<string, { eco: string; name: string; count: number }>();
    for (const g of reviewable) {
      const uci = g.movesUci.split(/\s+/).filter(Boolean);
      if (uci.length < 4) continue;
      const replay = replayUci(g.startFen, uci.slice(0, 12));
      const info = detectOpening(replay.history({ verbose: true }));
      if (!info) continue;
      const key = `${info.eco} ${info.name}`;
      const entry = openings.get(key) ?? { ...info, count: 0 };
      entry.count += 1;
      openings.set(key, entry);
    }
    if (!container.isConnected) return;
    const rows = [...openings.values()].sort((a, b) => b.count - a.count).slice(0, OPENINGS_LIMIT);
    (openingsCard.querySelector('.stat-openings') as HTMLElement).replaceChildren(
      ...(rows.length === 0
        ? [emptyNote('Openings appear once you have played a few games.')]
        : rows.map((row) =>
            el('div', { class: 'list-tile' },
              el('span', {}, el('b', {}, row.eco), ` ${row.name}`),
              el('span', { class: 'muted' }, `${row.count} ${row.count === 1 ? 'game' : 'games'}`)))));
  });

  /** Human label per game type (CPU / assessment / pass-and-play). */
  function gameListLabel(g: GameRecord): string {
    if (g.type === 'passplay') return ' pass-and-play';
    if (g.type === 'assessment') return ` vs ${Math.round(g.opponentRating)} · assessment`;
    return ` vs CPU ${Math.round(g.opponentRating)}`;
  }

  function reviewTile(g: GameRecord, analysed: boolean): HTMLElement {
    const res = g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D';
    return el('button', {
      class: 'moment-tile',
      onclick: () => void openReview(g, () => container.isConnected),
    },
      el('span', {}, el('b', {}, res), gameListLabel(g)),
      el('span', { class: 'muted' }, new Date(g.ts).toLocaleDateString()),
      analysed ? el('span', { class: 'chip' }, 'analyzed') : el('span', { class: 'chip' }, 'Analyze')
    );
  }
}

function statLine(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat-line' }, el('span', {}, label), el('b', {}, value));
}

function emptyNote(text: string): HTMLElement {
  return el('p', { class: 'muted stat-empty' }, text);
}
