/* Gambit service worker: offline shell + asset caching. */
const BASE = new URL(self.registration.scope).pathname;
const CACHE_VERSION = 'v3';
const SCOPE_ID = BASE.replace(/^\/+|\/+$/g, '').replace(/[^\w-]/g, '_') || 'root';
const CACHE_PREFIX = `gambit-${SCOPE_ID}-`;
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const LEGACY_CACHE = `gambit-${(self.registration.scope.match(/[\w-]+\/?$/) || ['v1'])[0].replace('/', '')}`;
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icons/icon.svg`];
const CACHE_FIRST_PREFIXES = ['engine/', 'data/', 'icons/', 'pieces/']
  .map((path) => new URL(path, self.registration.scope).pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key === LEGACY_CACHE || (key.startsWith(CACHE_PREFIX) && key !== CACHE))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function cacheResponse(event, response) {
  if (!response.ok || response.type === 'opaque') return;
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {}));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (CACHE_FIRST_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      cacheResponse(event, response);
      return response;
    })());
    return;
  }

  // Navigations and built app assets are network-first, with the installed shell offline fallback.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      cacheResponse(event, response);
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      return (await cache.match(event.request)) ?? (await cache.match(`${BASE}index.html`));
    }
  })());
});
