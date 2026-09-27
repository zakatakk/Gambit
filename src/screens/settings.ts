/** Settings: preferences, engine tier, difficulty override, data management. */
import { getSettings, saveSettings, getProfile, saveProfile, exportData, importData, clearAll } from '../db';
import { applyTheme } from '../theme';
import { setSoundsEnabled, play } from '../sounds';
import { el, toast, switchControl, modal } from '../ui';
import type { App } from '../app';
import type { Settings, EngineTier } from '../types';

export async function mountSettings(container: HTMLElement, app: App): Promise<void> {
  const s = await getSettings();
  const p = await getProfile();

  const oppSlider = el('input', { type: 'range', min: '600', max: '2900', step: '25' }) as HTMLInputElement;
  oppSlider.value = String(Math.round(p.rating));
  const oppLabel = el('b', {}, `${oppSlider.value}`);
  oppSlider.addEventListener('input', () => {
    oppLabel.textContent = oppSlider.value;
  });
  oppSlider.addEventListener('change', async () => {
    const prof = await getProfile();
    prof.rating = parseInt(oppSlider.value, 10);
    await saveProfile(prof);
    toast(`Opponent rating set to ${oppSlider.value}`);
  });

  const tierSel = el('select', {},
    el('option', { value: 'lite' }, 'Lite (small download, ~2350 max)'),
    el('option', { value: 'full' }, 'Full NNUE (40MB, strongest)')
  ) as HTMLSelectElement;
  tierSel.value = s.engineTier;
  tierSel.addEventListener('change', async () => {
    const tier: EngineTier = tierSel.value as EngineTier;
    if (tier === 'full') {
      const { engine } = await import('../engineClient');
      const bar = el('div', { class: 'progress' }, el('div', {}));
      const close = modal(el('h2', {}, 'Downloading full engine…'), bar,
        el('p', { class: 'muted' }, 'One-time ~40MB. Works offline after.'));
      try {
        await engine.init('full', (_ph, frac) => {
          (bar.firstChild as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
        });
        const st = await getSettings();
        st.engineTier = 'full';
        await saveSettings(st);
        play('success');
        toast('Full engine ready.');
      } catch (e) {
        toast(`Download failed: ${(e as Error).message}`);
      }
      close();
      app.refreshRating();
      return;
    }
    const st = await getSettings();
    st.engineTier = 'lite';
    await saveSettings(st);
    toast('Using lite engine.');
  });

  const themeSel = el('select', {},
    el('option', { value: 'system' }, 'Follow system'),
    el('option', { value: 'dark' }, 'Dark'),
    el('option', { value: 'light' }, 'Light')
  ) as HTMLSelectElement;
  themeSel.value = s.theme;
  themeSel.addEventListener('change', async () => {
    const st = await getSettings();
    st.theme = themeSel.value as Settings['theme'];
    await saveSettings(st);
    applyTheme(st.theme);
  });

  const soundSwitch = switchControl(s.sounds, async (v) => {
    const st = await getSettings();
    st.sounds = v;
    await saveSettings(st);
    setSoundsEnabled(v);
    if (v) play('move');
  });

  const strictSwitch = switchControl(s.strictMode, async (v) => {
    const st = await getSettings();
    st.strictMode = v;
    await saveSettings(st);
  });

  const exportBtn = el('button', { onclick: () => void doExport() }, 'Export data (backup file)');
  const importInput = el('input', { type: 'file', accept: 'application/json', style: 'display:none' }) as HTMLInputElement;
  importInput.addEventListener('change', () => void doImport(importInput));
  const importBtn = el('button', { onclick: () => importInput.click() }, 'Import data');

  const reassessProbe = el('button', { onclick: () => doReassess('probe') }, 'Re-assess · puzzles + games');
  const reassessLadder = el('button', { onclick: () => doReassess('ladder') }, 'Re-assess · full ladder');
  const reassessQuick = el('button', { onclick: () => doReassess('quick') }, 'Re-assess · quick scan');
  const resetBtn = el('button', { class: 'danger', onclick: () => void doReset() }, 'Erase everything');

  container.append(
    el('div', { class: 'section' },
      el('h2', {}, 'Appearance'),
      el('div', { class: 'row' }, el('span', {}, 'Theme'), themeSel),
      el('div', { class: 'row' }, el('span', {}, 'Sounds'), soundSwitch)
    ),
    el('div', { class: 'section' },
      el('h2', {}, 'Difficulty'),
      el('div', { class: 'row' }, el('span', {}, 'Opponent rating'), oppLabel),
      oppSlider,
      el('div', { class: 'row' }, el('span', {}, 'Engine'), tierSel)
    ),
    el('div', { class: 'section' },
      el('h2', {}, 'Gameplay'),
      el('div', { class: 'row' },
        el('span', {}, 'Strict mode'),
        strictSwitch)
    ),
    el('div', { class: 'section' },
      el('h2', {}, 'Rating'),
      el('p', { class: 'muted', style: 'margin-top:0' },
        `${Math.round(p.rating)} ±${Math.round(p.rd)}${p.assessed ? '' : ' · not assessed'}`),
      reassessProbe,
      reassessLadder,
      reassessQuick
    ),
    el('div', { class: 'section' },
      el('h2', {}, 'Data'),
      el('p', { class: 'tiny', style: 'margin-top:0' }, 'Stored on this device only.'),
      el('div', { class: 'btn-row' }, exportBtn, importBtn),
      importInput,
      el('div', { class: 'btn-row' }, resetBtn)
    ),
    el('div', { class: 'section' },
      el('p', { class: 'tiny', style: 'margin:0' },
        'Glicko-2 rating · Stockfish engine (GPL) · Lichess puzzles (CC0)')
    )
  );

  async function doExport(): Promise<void> {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gambit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup downloaded.');
  }

  async function doImport(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      await importData(text);
      toast('Data imported.');
      app.refreshRating();
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`);
    }
  }

  function doReassess(mode: 'probe' | 'ladder' | 'quick'): void {
    void (async () => {
      const prof = await getProfile();
      prof.assessed = false;
      await saveProfile(prof);
      toast(mode === 'quick' ? 'Quick scan starting…' : 'Fresh assessment starting…');
      app.navigate('play', { assessment: true, mode });
    })();
  }

  async function doReset(): Promise<void> {
    if (!confirm('Erase rating, games, and puzzle history? This cannot be undone.')) return;
    await clearAll();
    toast('Everything erased.');
    app.refreshRating();
  }
}
