import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProgress } from '../src/engineClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('engine asset prefetch', () => {
  it('streams downloads into Cache Storage and reports progress', async () => {
    const put = vi.fn(async () => undefined);
    const match = vi.fn(async () => undefined);
    const cache = { match, put };
    const open = vi.fn(async () => cache);
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'content-length': '4' },
    }));
    vi.stubGlobal('caches', { open });
    vi.stubGlobal('fetch', fetchStub);
    const progress: number[] = [];

    await fetchProgress('/engine/test.wasm', (fraction) => progress.push(fraction), 4);

    expect(fetchStub).toHaveBeenCalledOnce();
    expect(match).toHaveBeenCalledWith('/engine/test.wasm');
    expect(put).toHaveBeenCalledOnce();
    expect(progress.at(-1)).toBe(1);
    expect(progress[0]).toBe(1);
    expect(progress.at(-1)).toBe(1);
  });

  it('uses cached assets for offline startup without fetching', async () => {
    const match = vi.fn(async () => new Response(new Uint8Array([1])));
    const put = vi.fn();
    vi.stubGlobal('caches', { open: vi.fn(async () => ({ match, put })) });
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const progress: number[] = [];

    await fetchProgress('/engine/cached.wasm', (fraction) => progress.push(fraction));

    expect(fetchStub).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(progress).toEqual([1]);
  });

  it('rejects an HTML fallback page instead of caching it', async () => {
    const put = vi.fn(async () => undefined);
    vi.stubGlobal('caches', { open: vi.fn(async () => ({ match: vi.fn(async () => undefined), put })) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));

    await expect(fetchProgress('/engine/nn.nnue', () => {}, 4)).rejects.toThrow('missing from this deploy');
    expect(put).not.toHaveBeenCalled();
  });

  it('replaces an HTML page cached by an older build', async () => {
    const cache = {
      match: vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([1, 2]), {
      headers: { 'content-type': 'application/octet-stream' },
    }));
    vi.stubGlobal('fetch', fetchStub);

    await fetchProgress('/engine/nn.nnue', () => {}, 2);

    expect(cache.delete).toHaveBeenCalledWith('/engine/nn.nnue');
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('rejects a truncated download and does not keep it cached', async () => {
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), delete: vi.fn(async () => true) };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]))));

    await expect(fetchProgress('/engine/nn.nnue', () => {}, 4)).rejects.toThrow('expected 4');
    expect(cache.delete).toHaveBeenCalledWith('/engine/nn.nnue');
  });

  it('still loads online if Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', { open: vi.fn(async () => { throw new Error('quota'); }) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]))));
    const progress: number[] = [];

    await fetchProgress('/engine/no-cache.wasm', (fraction) => progress.push(fraction), 2);

    expect(progress.at(-1)).toBe(1);
  });
});
