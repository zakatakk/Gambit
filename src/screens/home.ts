/** Home: rating overview, assessment entry, engine download. */
import { getProfile, getSettings, countGames, getAttempts, updateSettings, getSavedAssessment } from '../db';
import { engine } from '../engineClient';
import { el, modal, toast } from '../ui';
import { play } from '../sounds';
import type { App } from '../app';

export async function mountHome(container: HTMLElement, app: App): Promise<void> {
  const [profile, settings, gameCount, attempts] = await Promise.all([
    getProfile(),
    getSettings(),
    countGames(),
    getAttempts(),
  ]);
  if (!container.isConnected) return;

  const savedAssessment = await getSavedAssessment().catch(() => null);
  const hasSaved = Boolean(savedAssessment) && !profile.assessed;

  const hero = el('div', { class: 'hero' },
    el('div', { class: 'brand' }, el('h1', {}, 'Gambit')),
    el('div', { class: 'rating-line' },
      el('span', { class: 'big numeral' }, String(Math.round(profile.rating))),
      el('span', { class: 'meta' }, profile.assessed
        ? el('span', {}, 'your rating', el('br'), el('b', {}, `± ${Math.round(profile.rd)}`))
        : el('span', {}, 'unrated', el('br'), 'run an assessment'))
    ),
    el('div', { class: 'statline' },
      el('div', {}, el('div', { class: 'k' }, 'Games'),
        el('div', { class: 'v numeral' }, String(gameCount))),
      el('div', {}, el('div', { class: 'k' }, 'Puzzles'),
        el('div', { class: 'v numeral' }, String(attempts.length))),
      el('div', {}, el('div', { class: 'k' }, 'Solved'),
        el('div', { class: 'v numeral' }, String(attempts.filter((attempt) => attempt.won).length)))
    )
  );

  const train = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, profile.assessed ? 'Play' : 'Establish a rating'),
    profile.assessed
      ? el('div', { class: 'btn-row' },
          el('button', { class: 'primary', onclick: () => app.navigate('play', { rematch: true }) }, 'Play vs CPU'),
          el('button', { onclick: () => app.navigate('puzzles') }, 'Puzzles'))
      : el('div', {},
          modeTile('Puzzles + games', hasSaved ? 'resume · saved progress' : 'recommended · ~15 min', () => startAssessment(app, 'probe')),
          modeTile('Full ladder', hasSaved ? 'resume · saved progress' : '~10-14 games', () => startAssessment(app, 'ladder')),
          modeTile('Quick scan', hasSaved ? 'resume · saved progress' : '6 games · rough', () => startAssessment(app, 'quick'))
      )
  );
  const about = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Engine'),
    el('div', { class: 'row' },
      el('span', { class: 'muted' }, 'Stockfish build'),
      el('b', { style: 'font-size:0.9rem' }, settings.engineTier === 'full' ? 'Full NNUE · strongest' : 'Lite · ~2350 ceiling')),
    settings.engineTier === 'lite'
      ? el('button', { class: 'small', onclick: () => void upgradeEngine(app, container) }, 'Get full engine · 40MB')
      : null
  );
  container.append(hero, train, about);
}

function modeTile(title: string, detail: string, onTap: () => void): HTMLElement {
  return el('button', { class: 'mode-tile', onclick: onTap },
    el('div', { class: 't' }, title),
    el('div', { class: 'd' }, detail));
}

function startAssessment(app: App, mode: 'probe' | 'ladder' | 'quick'): void {
  app.navigate('play', { assessment: true, mode });
}

async function upgradeEngine(app: App, container: HTMLElement): Promise<void> {
  const progress = el('div', { class: 'progress' }, el('div', {}));
  const close = modal(
    el('h2', {}, 'Downloading full engine'),
    progress,
    el('p', { class: 'muted' }, 'One-time ~40MB. After this it works offline.')
  );
  try {
    await engine.init('full', (_phase, fraction) => {
      const bar = progress.firstElementChild as HTMLElement | null;
      if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
    });
    if (!container.isConnected) return;
    await updateSettings({ engineTier: 'full' });
    if (!container.isConnected) return;
    play('success');
    toast('Full engine ready.');
  } catch (error) {
    if (container.isConnected) toast(`Download failed: ${(error as Error).message}`);
  } finally {
    close();
  }
  if (container.isConnected) await app.refreshRating();
}
