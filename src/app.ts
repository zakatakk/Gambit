/** App shell: bottom-tab navigation and screen mounting. */
import { applyTheme, watchSystemTheme } from './theme';
import { setSoundsEnabled, primeAudio } from './sounds';
import { getSettings, getProfile } from './db';
import { engine } from './engineClient';
import { el, modal, toast } from './ui';
import { mountHome } from './screens/home';
import { mountPlay } from './screens/play';
import { mountPuzzles } from './screens/puzzles';
import { mountStats } from './screens/stats';
import { mountSettings } from './screens/settings';

export interface App {
  navigate(tab: 'home' | 'play' | 'puzzles' | 'stats' | 'settings', params?: Record<string, unknown>): void;
  refreshRating(): Promise<void>;
}

const appEl = document.getElementById('app')!;
let current: HTMLElement | null = null;
let activeTab = 'home';

const TABS = [
  { id: 'home', label: 'Home', ico: '⌂' },
  { id: 'play', label: 'Play', ico: '♞' },
  { id: 'puzzles', label: 'Puzzles', ico: '★' },
  { id: 'stats', label: 'Stats', ico: '▲' },
  { id: 'settings', label: 'Settings', ico: 'settings' },
] as const;

async function render(app: App): Promise<void> {
  if (current) current.remove();
  // Close any lingering bottom sheets from the previous screen.
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  const mount = el('div');
  appEl.appendChild(mount);
  current = mount;
  switch (activeTab) {
    case 'home': await mountHome(mount, app); break;
    case 'play': await mountPlay(mount, app, {}); break;
    case 'puzzles': await mountPuzzles(mount, app); break;
    case 'stats': await mountStats(mount, app); break;
    case 'settings': await mountSettings(mount, app); break;
  }
  for (const b of document.querySelectorAll('nav.tabs button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === activeTab);
  }
}

export function bootApp(): void {
  // Tabs
  const nav = el('nav', { class: 'tabs' });
  for (const t of TABS) {
    const b = el(
      'button',
      { 'data-tab': t.id, onclick: () => { primeAudio(); app.navigate(t.id); } },
      t.ico === 'settings'
        ? settingsIcon()
        : el('span', { class: 'ico' }, t.ico),
      el('span', {}, t.label)
    );
    nav.appendChild(b);
  }
  document.body.appendChild(nav);

  const app: App = {
    navigate(tab, params) {
      activeTab = tab;
      if (tab === 'play') {
        if (current) current.remove();
        current = el('div');
        appEl.appendChild(current);
        void mountPlay(current, app, params ?? {});
        for (const b of document.querySelectorAll('nav.tabs button')) {
          b.classList.toggle('active', (b as HTMLElement).dataset.tab === 'play');
        }
        return;
      }
      void render(app);
    },
    async refreshRating() {
      void render(app);
    },
  };

  void (async () => {
    const s = await getSettings();
    applyTheme(s.theme);
    setSoundsEnabled(s.sounds);
    watchSystemTheme(() => {
      void getSettings().then((st) => applyTheme(st.theme));
    });

    const engineProgress = el('div', { class: 'progress' }, el('div', {}));
    const engineStatus = el('p', { class: 'muted' }, 'Checking for the full Stockfish engine…');
    const closeLoading = modal(
      el('h2', {}, 'Preparing chess engine…'),
      engineProgress,
      engineStatus
    );
    try {
      await engine.init('full', (phase, frac) => {
        const bar = engineProgress.firstElementChild as HTMLElement | null;
        if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
        if (phase === 'download') {
          engineStatus.textContent = `Downloading full Stockfish engine — ${Math.round(frac * 100)}%. It will work offline afterward.`;
        } else if (phase === 'booting') {
          engineStatus.textContent = 'Starting Stockfish…';
        }
      });
      s.engineTier = 'full';
      await (await import('./db')).saveSettings(s);
      closeLoading();
    } catch (error) {
      closeLoading();
      toast(`Full engine download failed: ${(error as Error).message}. Lite engine will be used.`);
      if (s.engineTier === 'full') {
        s.engineTier = 'lite';
        await (await import('./db')).saveSettings(s);
      }
      try {
        await engine.init('lite');
      } catch {
        toast('Lite engine did not load; check your connection and try Play again.');
      }
    }

    // First-run nudge
    const p = await getProfile();
    if (!p.assessed) {
      setTimeout(() => toast('New here? Run the rating assessment from Home.'), 900);
    }
    await render(app);
  })();
}

function settingsIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico settings-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 4.5a7.7 7.7 0 0 0-.1-1.3l1.5-1.2-1.5-2.7-1.8.7a8 8 0 0 0-2.2-1.3L16.6 5h-3.1l-.4 1.9a8 8 0 0 0-2.2 1.3l-1.8-.7-1.5 2.7 1.5 1.2a7.7 7.7 0 0 0 0 2.6l-1.5 1.2 1.5 2.7 1.8-.7a8 8 0 0 0 2.2 1.3l.4 1.9h3.1l.4-1.9a8 8 0 0 0 2.2-1.3l1.8.7 1.5-2.7-1.5-1.2c.1-.4.1-.9.1-1.3Z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export { el };
