/** Settings: preferences, engine tier, difficulty override, and data management.
 * Screens are collapsible panels so the whole page fits one phone viewport. */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { getSettings, updateSettings, getProfile, updateProfile, exportData, importData, clearAll, getSavedAssessment } from '../db';
import { engine } from '../engineClient';
import { ACCENTS, SKINS, applyAccent, applySkin, applyTheme } from '../theme';
import { applyBoardTheme, applyPieceSet, BOARD_THEMES, PIECE_SETS } from '../pieces';
import { setSoundsEnabled, play } from '../sounds';
import { el, toast, switchControl, modal, confirmSheet } from '../ui';
import type { App } from '../app';
import type { Settings, EngineTier } from '../types';

const PIECE_SET_LABELS: Record<string, string> = {
  cburnett: 'Classic',
  staunty: 'Staunton',
  merida: 'Merida',
};
const BOARD_THEME_LABELS: Record<string, string> = {
  walnut: 'Walnut',
  marine: 'Marine',
  slate: 'Slate',
};

/** Italian Game, after 3.Nf3 — shows all six piece types in both colors. */
const PREVIEW_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 1 3';

export async function mountSettings(container: HTMLElement, app: App): Promise<void> {
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  if (!container.isConnected) return;
  applyPieceSet(settings.pieceSet);
  applyBoardTheme(settings.boardTheme);

  // Example board: the same square/piece markup as the real board, so the
  // preview tracks the chosen pieces and palette exactly.
  const preview = new Board(el('div', { class: 'board-wrap preview-wrap' }), new Chess(PREVIEW_FEN), {
    orientation: 'w',
    interactive: false,
    onMove: () => {},
  });
  preview.setLastMove({ from: 'g1', to: 'f3' });
  preview.render();

  const opponentSlider = el('input', { type: 'range', min: '600', max: '2900', step: '25' }) as HTMLInputElement;
  opponentSlider.value = String(Math.max(600, Math.min(2900, Math.round(settings.lastOpponentRating ?? profile.rating))));
  const opponentLabel = el('b', {}, opponentSlider.value);
  opponentSlider.addEventListener('input', () => { opponentLabel.textContent = opponentSlider.value; });
  opponentSlider.addEventListener('change', () => {
    void (async () => {
      try {
        await updateSettings({ lastOpponentRating: Number(opponentSlider.value) });
        if (container.isConnected) toast(`Opponent rating set to ${opponentSlider.value}`);
      } catch (error) {
        if (container.isConnected) toast(`Could not save opponent rating: ${(error as Error).message}`);
      }
    })();
  });

  const tierSelect = el('select', {},
    el('option', { value: 'lite' }, 'Lite (~2350 max)'),
    el('option', { value: 'full' }, 'Full NNUE (40MB)')) as HTMLSelectElement;
  tierSelect.value = settings.engineTier;
  tierSelect.addEventListener('change', () => {
    void (async () => {
      const selectedTier = tierSelect.value as EngineTier;
      if (selectedTier === 'full') {
        const progress = el('div', { class: 'progress' }, el('div', {}));
        const close = modal(el('h2', {}, 'Downloading full engine…'), progress,
          el('p', { class: 'muted' }, 'One-time ~40MB. Works offline after.'));
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
          if (container.isConnected) tierSelect.value = 'lite';
        } finally {
          close();
        }
        if (container.isConnected) await app.refreshRating();
        return;
      }
      try {
        await updateSettings({ engineTier: 'lite' });
        if (container.isConnected) toast('Using lite engine.');
      } catch (error) {
        if (container.isConnected) toast(`Could not save engine preference: ${(error as Error).message}`);
      }
    })();
  });

  const styleSelect = el('select', {},
    ...SKINS.map((skin) => el('option', { value: skin.id }, skin.label))) as HTMLSelectElement;
  styleSelect.value = settings.skin;
  styleSelect.addEventListener('change', () => {
    void updateSetting('skin', styleSelect.value as Settings['skin'], applySkin);
  });

  const themeSelect = el('select', {},
    el('option', { value: 'system' }, 'System'),
    el('option', { value: 'dark' }, 'Dark'),
    el('option', { value: 'light' }, 'Light')) as HTMLSelectElement;
  themeSelect.value = settings.theme;
  themeSelect.addEventListener('change', () => {
    void updateSetting('theme', themeSelect.value as Settings['theme'], applyTheme);
  });

  const pieceSelect = el('select', {},
    ...PIECE_SETS.map((set) => el('option', { value: set }, PIECE_SET_LABELS[set] ?? set))) as HTMLSelectElement;
  pieceSelect.value = settings.pieceSet;
  pieceSelect.addEventListener('change', () => {
    void updateSetting('pieceSet', pieceSelect.value as Settings['pieceSet'], (value) => {
      applyPieceSet(value);
      preview.render();
    });
  });

  const boardSelect = el('select', {},
    el('option', { value: 'auto' }, 'Style default'),
    ...BOARD_THEMES.filter((theme) => theme !== 'auto').map((theme) => el('option', { value: theme }, BOARD_THEME_LABELS[theme] ?? theme))) as HTMLSelectElement;
  boardSelect.value = settings.boardTheme;
  boardSelect.addEventListener('change', () => {
    void updateSetting('boardTheme', boardSelect.value as Settings['boardTheme'], applyBoardTheme);
  });

  const accentSelect = el('select', {},
    ...ACCENTS.map((accent) => el('option', { value: accent.id }, accent.label))) as HTMLSelectElement;
  accentSelect.value = settings.accent;
  accentSelect.addEventListener('change', () => {
    void updateSetting('accent', accentSelect.value as Settings['accent'], applyAccent);
  });

  const autoQueenSwitch = switchControl(settings.autoQueen, (enabled) => {
    void updateSetting('autoQueen', enabled);
  });
  const coordsSwitch = switchControl(settings.showCoords, (enabled) => {
    void updateSetting('showCoords', enabled);
  });

  const soundSwitch = switchControl(settings.sounds, (enabled) => {
    void updateSetting('sounds', enabled, setSoundsEnabled).then(() => { if (enabled && container.isConnected) play('move'); });
  });
  const strictSwitch = switchControl(settings.strictMode, (enabled) => {
    void updateSetting('strictMode', enabled);
  });

  const exportButton = el('button', { onclick: () => void doExport() }, 'Export backup');
  const importInput = el('input', { type: 'file', accept: 'application/json', style: 'display:none' }) as HTMLInputElement;
  importInput.addEventListener('change', () => void doImport(importInput));
  const importButton = el('button', { onclick: () => importInput.click() }, 'Import backup');
  const reassessButtons = (['probe', 'ladder', 'quick'] as const).map((mode) =>
    el('button', { onclick: () => doReassess(mode) },
      mode === 'probe' ? 'Re-assess · puzzles + games' : mode === 'ladder' ? 'Re-assess · full ladder' : 'Re-assess · quick scan'));
  const resetButton = el('button', { class: 'danger', onclick: () => void doReset() }, 'Erase everything');
  const resetStyleButton = el('button', { class: 'small settings-reset-style', onclick: () => void resetStyle() }, 'Reset all styles');

  container.append(
    panel('Appearance', 'appearance',
      el('div', { class: 'appearance-grid' },
        row('Style', styleSelect),
        row('Theme', themeSelect),
        row('Accent', accentSelect),
        row('Pieces', pieceSelect),
        row('Board', boardSelect),
        row('Sounds', soundSwitch)),
      preview.el.parentElement as HTMLElement,
      resetStyleButton),
    panel('Difficulty', 'difficulty',
      row('Opponent rating', opponentLabel),
      opponentSlider,
      row('Engine', tierSelect)),
    panel('Gameplay', 'gameplay',
      row('Strict mode', strictSwitch),
      row('Always promote to queen', autoQueenSwitch),
      row('Board coordinates', coordsSwitch)),
    panel('Rating', 'rating',
      el('p', { class: 'muted', style: 'margin-top:0' },
        `${Math.round(profile.rating)} ±${Math.round(profile.rd)}${profile.assessed ? '' : ' · not assessed'}`),
      ...reassessButtons),
    panel('Data', 'data',
      el('p', { class: 'tiny', style: 'margin-top:0' }, 'Stored on this device only.'),
      el('div', { class: 'btn-row' }, exportButton, importButton),
      importInput,
      el('div', { class: 'btn-row' }, resetButton)),
    el('p', { class: 'tiny center', style: 'margin:10px 0' },
      'Glicko-2 rating · Stockfish engine (GPL) · Lichess puzzles (CC0)')
  );

  /** Collapsible section: keeps every settings group on one screen.
   * Opening one panel closes the others, so the page never grows tall. */
  function panel(title: string, id: string, ...children: Node[]): HTMLDetailsElement {
    const details = el('details', { class: `settings-panel settings-${id}` }) as HTMLDetailsElement;
    if (id === 'appearance') details.setAttribute('open', '');
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      for (const other of document.querySelectorAll('details.settings-panel[open]')) {
        if (other !== details) (other as HTMLDetailsElement).open = false;
        else other.classList.add('open');
      }
    });
    const summary = el('summary', {},
      el('span', { class: 'p-title' }, title),
      el('span', { class: 'p-arrow', 'aria-hidden': 'true' }, '▸'));
    details.append(summary, el('div', { class: 'panel-body' }, ...children));
    return details;
  }

  function row(label: string, control: HTMLElement): HTMLElement {
    return el('div', { class: 'row' }, el('span', {}, label), control);
  }

  async function updateSetting<K extends 'theme' | 'sounds' | 'strictMode' | 'pieceSet' | 'boardTheme' | 'skin' | 'accent' | 'autoQueen' | 'showCoords'>(
    key: K,
    value: Settings[K],
    apply?: (value: Settings[K]) => void
  ): Promise<void> {
    try {
      await updateSettings({ [key]: value } as Partial<Settings>);
      if (container.isConnected) apply?.(value);
    } catch (error) {
      if (container.isConnected) toast(`Could not save setting: ${(error as Error).message}`);
    }
  }

  async function resetStyle(): Promise<void> {
    const ok = await confirmSheet({
      title: 'Reset styles?',
      message: 'Style, theme, accent, pieces, and board colors go back to defaults.',
      confirmLabel: 'Reset styles',
    });
    if (!ok) return;
    try {
      await updateSettings({ skin: 'classic', theme: 'system', accent: 'oxblood', pieceSet: 'cburnett', boardTheme: 'walnut' });
      if (!container.isConnected) return;
      applySkin('classic');
      applyTheme('system');
      applyAccent('oxblood');
      applyPieceSet('cburnett');
      applyBoardTheme('walnut');
      styleSelect.value = 'classic';
      themeSelect.value = 'system';
      accentSelect.value = 'oxblood';
      pieceSelect.value = 'cburnett';
      boardSelect.value = 'walnut';
      preview.render();
      toast('Styles reset.');
    } catch (error) {
      if (container.isConnected) toast(`Could not reset styles: ${(error as Error).message}`);
    }
  }

  async function doExport(): Promise<void> {
    try {
      const json = await exportData();
      if (!container.isConnected) return;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `gambit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Backup downloaded.');
    } catch (error) {
      if (container.isConnected) toast(`Export failed: ${(error as Error).message}`);
    }
  }

  async function doImport(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await importData(await file.text());
      if (!container.isConnected) return;
      const importedSettings = await getSettings();
      applyTheme(importedSettings.theme);
      applySkin(importedSettings.skin);
      applyAccent(importedSettings.accent);
      applyPieceSet(importedSettings.pieceSet);
      applyBoardTheme(importedSettings.boardTheme);
      setSoundsEnabled(importedSettings.sounds);
      styleSelect.value = importedSettings.skin;
      themeSelect.value = importedSettings.theme;
      accentSelect.value = importedSettings.accent;
      pieceSelect.value = importedSettings.pieceSet;
      boardSelect.value = importedSettings.boardTheme;
      preview.render();
      toast('Data imported.');
      await app.refreshRating();
    } catch (error) {
      if (container.isConnected) toast(`Import failed: ${(error as Error).message}`);
    } finally {
      input.value = '';
    }
  }

  function doReassess(mode: 'probe' | 'ladder' | 'quick'): void {
    void (async () => {
      try {
        const saved = await getSavedAssessment().catch(() => null);
        if (saved && !(await confirmSheet({
          title: 'Start a new assessment?',
          message: 'Unfinished assessment progress will be discarded.',
          confirmLabel: 'Start new',
          danger: true,
        }))) return;
        await updateProfile({ assessed: false });
        if (!container.isConnected) return;
        toast(mode === 'quick' ? 'Quick scan starting…' : 'Fresh assessment starting…');
        app.navigate('play', { assessment: true, mode });
      } catch (error) {
        if (container.isConnected) toast(`Could not start assessment: ${(error as Error).message}`);
      }
    })();
  }

  async function doReset(): Promise<void> {
    const ok = await confirmSheet({
      title: 'Erase everything?',
      message: 'Rating, games, and puzzle history will be deleted. This cannot be undone.',
      confirmLabel: 'Erase everything',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearAll();
      if (!container.isConnected) return;
      applyTheme('system');
      applySkin('classic');
      applyAccent('oxblood');
      applyPieceSet('cburnett');
      applyBoardTheme('walnut');
      setSoundsEnabled(true);
      toast('Everything erased.');
      await app.refreshRating();
    } catch (error) {
      if (container.isConnected) toast(`Could not erase data: ${(error as Error).message}`);
    }
  }
}
