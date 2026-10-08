/** App shell: bottom-tab navigation and screen mounting. */
import { applyTheme, watchSystemTheme } from './theme';
import { setSoundsEnabled, primeAudio } from './sounds';
import { getSettings, getProfile } from './db';
import { el, toast } from './ui';
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
  { id: 'settings', label: 'Settings', ico: '' },
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
      t.ico ? el('span', { class: 'ico' }, t.ico) : null,
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
    // First-run nudge
    const p = await getProfile();
    if (!p.assessed) {
      setTimeout(() => toast('New here? Run the rating assessment from Home.'), 900);
    }
    await render(app);
  })();
}

export { el };
