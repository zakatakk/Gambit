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

export type AppTab = 'home' | 'play' | 'puzzles' | 'stats' | 'settings';

export interface App {
  navigate(tab: AppTab, params?: Record<string, unknown>): void;
  refreshRating(): Promise<void>;
}

const appEl = document.getElementById('app')!;
let current: HTMLElement | null = null;
let activeTab: AppTab = 'home';
let renderVersion = 0;

const TABS = [
  { id: 'home', label: 'Home', ico: '⌂' },
  { id: 'play', label: 'Play', ico: '♞' },
  { id: 'puzzles', label: 'Puzzles', ico: '★' },
  { id: 'stats', label: 'Stats', ico: '▲' },
  { id: 'settings', label: 'Settings', ico: 'settings' },
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
      tab.ico === 'settings' ? settingsIcon() : el('span', { class: 'ico' }, tab.ico),
      el('span', {}, tab.label)
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
