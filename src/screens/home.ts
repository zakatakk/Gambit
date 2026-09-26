/** Home: editorial masthead + rating + assessment entry. */
import { getProfile, getSettings, getHistory, getAttempts } from '../db';
import { el, modal, toast } from '../ui';
import { play } from '../sounds';
import type { App } from '../app';

export async function mountHome(container: HTMLElement, app: App): Promise<void> {
  const [profile, settings, history, attempts] = await Promise.all([
    getProfile(),
    getSettings(),
    getHistory(30),
    getAttempts(),
  ]);

  // ---- masthead ----
  const hero = el('div', { class: 'hero' },
    el('div', { class: 'brand' },
      el('h1', {}, 'Gambit')),
    el('div', { class: 'rating-line' },
      el('span', { class: 'big numeral' }, String(Math.round(profile.rating))),
      el('span', { class: 'meta' },
        profile.assessed
          ? el('span', {}, 'your rating', el('br'), el('b', {}, `± ${Math.round(profile.rd)}`))
          : el('span', {}, 'unrated', el('br'), 'run an assessment'))
    ),
    el('div', { class: 'statline' },
      el('div', {},
        el('div', { class: 'k' }, 'Games'),
        el('div', { class: 'v numeral' }, String(history.filter((h) => h.kind === 'game' || h.kind === 'assessment').length))),
      el('div', {},
        el('div', { class: 'k' }, 'Puzzles'),
        el('div', { class: 'v numeral' }, String(attempts.length))),
      el('div', {},
        el('div', { class: 'k' }, 'Solved'),
        el('div', { class: 'v numeral' }, String(attempts.filter((a) => a.won).length)))
    )
  );

  // ---- assessment / play ----
  const train = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, profile.assessed ? 'Play' : 'Establish a rating'),
    profile.assessed
      ? el('div', { class: 'btn-row' },
          el('button', { class: 'primary', onclick: () => app.navigate('play', { rematch: true }) }, 'Play vs CPU'),
          el('button', { onclick: () => app.navigate('puzzles') }, 'Puzzles'))
      : el('div', {},
          modeTile('Puzzles + games', 'recommended · ~15 min', () => startAssessment(app, 'probe'), true),
          modeTile('Full ladder', '~10-14 games', () => startAssessment(app, 'ladder')),
          modeTile('Quick scan', '6 games · rough', () => startAssessment(app, 'quick'))
      )
  );

  const engineTierLabel = settings.engineTier === 'full' ? 'Full NNUE · strongest' : 'Lite · ~2350 ceiling';
  const about = el('div', { class: 'section' },
    el('p', { class: 'kicker' }, 'Engine'),
    el('div', { class: 'row' },
      el('span', { class: 'muted' }, 'Stockfish build'),
      el('b', { style: 'font-size:0.9rem' }, engineTierLabel)),
    settings.engineTier === 'lite'
      ? el('button', { class: 'small', onclick: () => upgradeEngine(app) },
          'Get full engine · 40MB')
      : null
  );

  container.append(hero, train, about);
}

function modeTile(title: string, detail: string, onTap: () => void, _primary = false): HTMLElement {
  return el('button', { class: 'mode-tile', onclick: onTap },
    el('div', { class: 't' }, title),
    el('div', { class: 'd' }, detail)
  );
}

function startAssessment(app: App, mode: 'probe' | 'ladder' | 'quick'): void {
  play('success');
  app.navigate('play', { assessment: true, mode });
}

async function upgradeEngine(app: App): Promise<void> {
  const { engine } = await import('../engineClient');
  const close = modal(
    el('h2', {}, 'Downloading full engine'),
    el('div', { class: 'progress' }, el('div', {})),
    el('p', { class: 'muted' }, 'One-time ~40MB. After this it works offline.')
  );
  try {
    await engine.init('full', (_phase, frac) => {
      const bar = document.querySelector('.modal .progress > div') as HTMLElement | null;
      if (!bar) return;
      bar.style.width = `${Math.round(frac * 100)}%`;
    });
    const { getSettings, saveSettings } = await import('../db');
    const s = await getSettings();
    s.engineTier = 'full';
    await saveSettings(s);
    play('success');
    toast('FULL ENGINE READY — STRONGEST PLAY UNLOCKED');
    close();
    void app.refreshRating();
  } catch (e) {
    toast(`DOWNLOAD FAILED: ${(e as Error).message.toUpperCase().slice(0, 60)} — TRY WI-FI`);
    close();
  }
}
