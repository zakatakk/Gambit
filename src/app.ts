/** App shell: bottom-tab navigation and screen mounting. */
import { applyTheme, watchSystemTheme } from './theme';
import { setSoundsEnabled, primeAudio } from './sounds';
import { getSettings, getProfile } from './db';
import { applyBoardTheme, applyPieceSet } from './pieces';
import { el, toast } from './ui';
import { mountHome } from './screens/home';
import { mountPlay } from './screens/play';
import { mountPuzzles } from './screens/puzzles';
import { mountStats } from './screens/stats';
import { mountSettings } from './screens/settings';
import { mountAnalysis } from './screens/analysis';

export type AppTab = 'home' | 'play' | 'puzzles' | 'analysis' | 'stats' | 'settings';

export interface App {
  navigate(tab: AppTab, params?: Record<string, unknown>): void;
  refreshRating(): Promise<void>;
}

const appEl = document.getElementById('app')!;
let current: HTMLElement | null = null;
let activeTab: AppTab = 'home';
let renderVersion = 0;

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
  { id: 'puzzles', label: 'Puzzles' },
  { id: 'analysis', label: 'Analyse' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
] as const;

async function render(app: App, params?: Record<string, unknown>): Promise<void> {
  const version = ++renderVersion;
  const tabToRender = activeTab;
  if (current) {
    current.dispatchEvent(new Event('screen-dispose'));
    current.remove();
  }
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());

  const mount = el('div');
  appEl.appendChild(mount);
  current = mount;

  try {
    switch (tabToRender) {
      case 'home': await mountHome(mount, app); break;
      case 'play': await mountPlay(mount, app, params ?? {}); break;
      case 'puzzles': await mountPuzzles(mount, app); break;
      case 'analysis': await mountAnalysis(mount, app); break;
      case 'stats': await mountStats(mount, app); break;
      case 'settings': await mountSettings(mount, app); break;
    }
  } catch (error) {
    if (renderVersion !== version || current !== mount) return;
    const message = error instanceof Error ? error.message : String(error);
    mount.append(el('div', { class: 'section' },
      el('h2', {}, 'This screen could not be loaded'),
      el('p', { class: 'muted' }, message),
      el('button', { class: 'primary', onclick: () => void render(app, params) }, 'Try again')));
  }

  if (renderVersion !== version || current !== mount || activeTab !== tabToRender) return;
  for (const button of document.querySelectorAll('nav.tabs button')) {
    button.classList.toggle('active', (button as HTMLElement).dataset.tab === tabToRender);
  }
}

export function bootApp(): void {
  const nav = el('nav', { class: 'tabs' });
  for (const tab of TABS) {
    const button = el(
      'button',
      { 'data-tab': tab.id, onclick: () => { primeAudio(); app.navigate(tab.id); } },
      tab.label
    );
    nav.appendChild(button);
  }
  document.body.appendChild(nav);

  const app: App = {
    navigate(tab, params) {
      activeTab = tab;
      void render(app, params);
    },
    refreshRating() {
      return render(app);
    },
  };

  // Render immediately; loading settings or the full engine must not block UI.
  void render(app);

  void (async () => {
    try {
      const settings = await getSettings();
      applyTheme(settings.theme);
      applyPieceSet(settings.pieceSet);
      applyBoardTheme(settings.boardTheme);
      setSoundsEnabled(settings.sounds);
      watchSystemTheme(() => {
        void getSettings().then((latest) => applyTheme(latest.theme));
      });

      const profile = await getProfile();
      if (!profile.assessed) {
        setTimeout(() => toast('New here? Run the rating assessment from Home.'), 900);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(`Startup warning: ${message}`);
    }
  })();
}

export { el };
