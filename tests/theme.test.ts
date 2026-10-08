import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).window = {
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  };
});

const { ACCENTS, SKINS, applyAccent, applySkin, applyTheme, normalizeAccent, normalizeSkin } = await import('../src/theme');

function stubHead(): { dataset: Record<string, string>; metas: Record<string, string> } {
  const dataset: Record<string, string> = {};
  const metas: Record<string, string> = {};
  const makeMeta = () => ({
    set name(v: string) { metas['name'] = v; },
    get name() { return metas['name'] ?? ''; },
    set content(v: string) { metas['content'] = v; },
    get content() { return metas['content'] ?? ''; },
  });
  vi.stubGlobal('document', {
    documentElement: { dataset },
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? makeMeta() : null),
    createElement: () => makeMeta(),
    head: { appendChild: () => {} },
  });
  return { dataset, metas };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('skin registry', () => {
  it('registers five skins with both-mode chrome colors', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['classic', 'midnight', 'bauhaus', 'lakehouse', 'cyber']);
    for (const skin of SKINS) {
      expect(skin.chrome.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(skin.chrome.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('applies known skins and falls back to classic', () => {
    const { dataset } = stubHead();
    applySkin('bauhaus');
    expect(dataset.skin).toBe('bauhaus');
    applySkin('woodshop' as never);
    expect(dataset.skin).toBe('classic');
    expect(normalizeSkin(undefined)).toBe('classic');
    expect(normalizeSkin('midnight')).toBe('midnight');
  });

  it('theme sets data-theme and updates the theme-color meta from the active skin', () => {
    const { dataset, metas } = stubHead();
    applySkin('midnight');
    applyTheme('light');
    expect(dataset.theme).toBe('light');
    expect(metas['content']).toBe('#f2ede2');
    applyTheme('dark');
    expect(dataset.theme).toBe('dark');
    expect(metas['content']).toBe('#14161a');
    // Meta element is re-resolved on every chrome update.
    applyTheme('dark');
    expect(dataset.theme).toBe('dark');
    expect(metas['content']).toBe('#14161a');
  });
});

describe('accent registry', () => {
  it('falls back to oxblood for unknown accents', () => {
    const { dataset } = stubHead();
    applyAccent('royal');
    expect(dataset.accent).toBe('royal');
    applyAccent('magenta' as never);
    expect(dataset.accent).toBe('oxblood');
    expect(normalizeAccent(42)).toBe('oxblood');
    expect(ACCENTS).toHaveLength(4);
  });
});
