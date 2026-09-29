/** Settings: preferences, engine tier, difficulty override, and data management. */
import { Chess } from 'chess.js';
import { Board } from '../board';
import { getSettings, updateSettings, getProfile, updateProfile, exportData, importData, clearAll, getSavedAssessment } from '../db';
import { engine } from '../engineClient';
import { ACCENTS, SKINS, applyAccent, applySkin, applyTheme } from '../theme';
import { applyBoardTheme, applyPieceSet, BOARD_THEMES, PIECE_SETS } from '../pieces';
import { setSoundsEnabled, play } from '../sounds';
import { el, toast, switchControl, modal } from '../ui';
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
    el('option', { value: 'lite' }, 'Lite (small download, ~2350 max)'),
    el('option', { value: 'full' }, 'Full NNUE (40MB, strongest)')) as HTMLSelectElement;
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
    el('option', { value: 'system' }, 'Follow system'),
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

  container.append(
    el('div', { class: 'section' },
      el('h2', {}, 'Appearance'),
      el('div', { class: 'row' }, el('span', {}, 'Style'), styleSelect),
      el('div', { class: 'row' }, el('span', {}, 'Theme'), themeSelect),
      el('div', { class: 'row' }, el('span', {}, 'Accent'), accentSelect),
      el('div', { class: 'row' }, el('span', {}, 'Pieces'), pieceSelect),
      el('div', { class: 'row' }, el('span', {}, 'Board'), boardSelect),
      preview.el.parentElement as HTMLElement,
      el('div', { class: 'row' }, el('span', {}, 'Sounds'), soundSwitch)),
    el('div', { class: 'section' },
      el('h2', {}, 'Difficulty'),
      el('div', { class: 'row' }, el('span', {}, 'Opponent rating'), opponentLabel),
      opponentSlider,
      el('div', { class: 'row' }, el('span', {}, 'Engine'), tierSelect)),
    el('div', { class: 'section' },
      el('h2', {}, 'Gameplay'),
      el('div', { class: 'row' }, el('span', {}, 'Strict mode'), strictSwitch),
      el('div', { class: 'row' }, el('span', {}, 'Always promote to queen'), autoQueenSwitch),
      el('div', { class: 'row' }, el('span', {}, 'Board coordinates'), coordsSwitch)),
    el('div', { class: 'section' },
      el('h2', {}, 'Rating'),
      el('p', { class: 'muted', style: 'margin-top:0' },
        `${Math.round(profile.rating)} ±${Math.round(profile.rd)}${profile.assessed ? '' : ' · not assessed'}`),
      ...reassessButtons),
    el('div', { class: 'section' },
      el('h2', {}, 'Data'),
      el('p', { class: 'tiny', style: 'margin-top:0' }, 'Stored on this device only.'),
      el('div', { class: 'btn-row' }, exportButton, importButton),
      importInput,
      el('div', { class: 'btn-row' }, resetButton)),
    el('div', { class: 'section' },
      el('p', { class: 'tiny', style: 'margin:0' }, 'Glicko-2 rating · Stockfish engine (GPL) · Lichess puzzles (CC0)'))
  );

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
      toast('Data imported.');
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
        if (saved && !confirm('Start a new assessment? Unfinished assessment progress will be discarded.')) return;
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
    if (!confirm('Erase rating, games, and puzzle history? This cannot be undone.')) return;
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
