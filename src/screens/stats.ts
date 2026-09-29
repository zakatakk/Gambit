/** Stats: rating history chart, game record, puzzle accuracy, openings, reviews, history list. */
import { getHistory, recentGames, getAttempts, getProfile, reviewedGameTimestamps } from '../db';
import { engine } from '../engineClient';
import { el } from '../ui';
import { detectOpening, replayUci } from '../openings';
import { openReview } from './reviewView';
import type { App } from '../app';
import type { GameRecord } from '../types';

export async function mountStats(container: HTMLElement, _app: App): Promise<void> {
  container.addEventListener('screen-dispose', () => engine.cancelSearch(), { once: true });
  const [profile, history, games, attempts, reviewed] = await Promise.all([
    getProfile(),
    getHistory(200),
    recentGames(30),
    getAttempts(),
    reviewedGameTimestamps(),
  ]);
  if (!container.isConnected) return;

  const card = el('div', { class: 'card center' },
    el('p', { class: 'muted', style: 'margin:0' }, 'Rating'),
    el('div', {},
      el('span', { class: 'rating-big' }, String(Math.round(profile.rating))),
      el('span', { class: 'rd-badge' }, `± ${Math.round(profile.rd)}`))
  );

  // Rating sparkline (built with SVG namespace APIs).
  const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spark.setAttribute('class', 'spark');
  spark.setAttribute('viewBox', '0 0 300 90');
  spark.setAttribute('preserveAspectRatio', 'none');
  if (history.length >= 2) {
    const rs = history.map((h) => h.rating);
    const min = Math.min(...rs) - 20;
    const max = Math.max(...rs) + 20;
    const pts = history
      .map((h, i) => {
        const x = (i / (history.length - 1)) * 296 + 2;
        const y = 88 - ((h.rating - min) / Math.max(1, max - min)) * 84;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    spark.appendChild(poly);
  }

  const wins = games.filter((g) => g.result === 'win').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  const draws = games.filter((g) => g.result === 'draw').length;
  const solved = attempts.filter((a) => a.won).length;

  const recordCard = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Record'),
    el('div', { class: 'row' }, el('span', {}, 'CPU games'), el('b', {}, `${wins}W ${draws}D ${losses}L`)),
    el('div', { class: 'row' }, el('span', {}, 'Puzzles solved'), el('b', {}, `${solved} / ${attempts.length}`)),
    attempts.length
      ? el('div', { class: 'row' }, el('span', {}, 'Puzzle success'), el('b', {}, `${Math.round((solved / attempts.length) * 100)}%`))
      : el('span')
  );

  const reviewable = games.filter((g) => g.movesUci.trim().length > 0);

  const reviewsCard = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Learn'),
    reviewable.length === 0
      ? el('p', { class: 'muted' }, 'Play a game, then review it to learn from every move.')
      : el('div', {}, ...reviewable.slice(0, 10).map((g) =>
          reviewTile(g, reviewed.has(g.ts)) as Node))
  );

  const historyCard = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Recent games'),
    games.length === 0
      ? el('p', { class: 'muted' }, 'No games yet.')
      : el('div', {}, ...games.slice(0, 12).map((g) =>
          el('div', { class: 'list-tile' },
            el('span', {},
              el('b', {}, g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'),
              gameListLabel(g)),
            el('span', { class: 'muted' },
              new Date(g.ts).toLocaleDateString(),
              g.ratingAfter ? ` · ${Math.round(g.ratingBefore ?? 0)}→${Math.round(g.ratingAfter)}` : ''))
        ) as Node[])
  );

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
  const openingRows = [...openings.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const openingsCard = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Openings'),
    openingRows.length === 0
      ? el('p', { class: 'muted' }, 'Openings appear here once you have played a few games.')
      : el('div', {}, ...openingRows.map((row) =>
          el('div', { class: 'list-tile' },
            el('span', {}, el('b', {}, row.eco), ` ${row.name}`),
            el('span', { class: 'muted' }, `${row.count} ${row.count === 1 ? 'game' : 'games'}`))) as Node[])
  );

  container.append(card, spark, recordCard, openingsCard, reviewsCard, historyCard);

  container.append(card, spark, recordCard, reviewsCard, historyCard);

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
      analysed ? el('span', { class: 'chip' }, 'analysed') : el('span', { class: 'chip' }, 'Analyse')
    );
  }

}
