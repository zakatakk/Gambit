/* Gambit service worker: offline-first for the train.
 * All URLs are relative and the cache is versioned by a build hash injected
 * at build time (the workflow replaces __BASE__ with the deploy base path),
 * so this works identically at "/" (Netlify) and "/repo/" (GitHub Pages).
 */
const BASE = new URL(self.registration.scope).pathname; // deploy base, e.g. "/" or "/gambit/"
const CACHE = 'gambit-' + (self.registration.scope.match(/[\w-]+\/?$/) || ['v1'])[0].replace('/', '');
const SHELL = [BASE, BASE + 'index.html', BASE + 'manifest.webmanifest', BASE + 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHE_FIRST = [
  /^\/engine\//, /^\/data\//, /^\/icons\//, /^\/pieces\//,
].map((re) => new RegExp('^' + BASE.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').slice(0, -1) + re.source));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (CACHE_FIRST.some((re) => re.test(url.pathname))) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigation + hashed Vite assets: network first, cache fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match(BASE + 'index.html')))
  );
});
