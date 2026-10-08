/** App shell: bottom-tab navigation and screen mounting. */
import { applyAccent, applySkin, applyTheme, watchSystemTheme } from './theme';
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
  { id: 'analysis', label: 'Analysis' },
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
  // Per-screen density hook: lets CSS compact each screen so it fits one viewport.
  document.body.dataset.screen = tabToRender;

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
  for (const button of document.querySelectorAll('nav.sidebar button')) {
    button.classList.toggle('active', (button as HTMLElement).dataset.tab === tabToRender);
  }
}

export function bootApp(): void {
  // Sidebar navigation: hidden by default, opened from the edge handle.
  const scrim = el('div', { class: 'sidebar-scrim', onclick: () => setSidebar(false) });
  const sidebar = el('nav', { class: 'sidebar', 'aria-label': 'Sections' });
  for (const tab of TABS) {
    const button = el(
      'button',
      { 'data-tab': tab.id, onclick: () => { primeAudio(); app.navigate(tab.id); } },
      tab.label
    );
    sidebar.appendChild(button);
  }
  const handle = el('button', {
    class: 'menu-handle',
    'aria-label': 'Open menu',
    'aria-expanded': 'false',
    onclick: () => setSidebar(!document.body.classList.contains('sidebar-open')),
  }, menuIcon());
  document.body.append(handle, sidebar, scrim);
  // Off-screen links must not take keyboard focus until the menu is open.
  sidebar.inert = true;

  function setSidebar(open: boolean): void {
    const wasOpen = document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open);
    handle.setAttribute('aria-expanded', String(open));
    sidebar.inert = !open;
    // The drawer is modal: the page behind it is inert while it is open.
    appEl.inert = open;
    // Opening moves focus into the menu; closing returns it to the menu button.
    if (open && !wasOpen) sidebar.querySelector<HTMLButtonElement>('button.active')?.focus();
    if (!open && wasOpen) handle.focus();
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSidebar(false);
    if (e.key !== 'Tab' || !document.body.classList.contains('sidebar-open')) return;
    // Keep Tab cycling inside the open drawer instead of leaving it.
    const items = [...sidebar.querySelectorAll<HTMLButtonElement>('button')];
    const first = items[0];
    const last = items[items.length - 1];
    const focusInside = sidebar.contains(document.activeElement);
    if (e.shiftKey && (!focusInside || document.activeElement === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!focusInside || document.activeElement === last)) {
      e.preventDefault();
      first.focus();
    }
  });

  const app: App = {
    navigate(tab, params) {
      activeTab = tab;
      setSidebar(false);
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
      applySkin(settings.skin);
      applyAccent(settings.accent);
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

/** Hamburger icon for the sidebar handle (drawn inline: no glyph fonts). */
function menuIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const y of [6, 12, 18]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '3');
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', '21');
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }
  return svg;
}

export { el };
