/*
 * App-shell service worker: caches same-origin static assets as they are
 * fetched so the staff app reopens without coverage (API calls are never
 * cached — live data stays live, and the offline queue in the app handles
 * writes). Bump CACHE to invalidate after breaking asset changes; hashed
 * bundle filenames make that rarely necessary.
 */
const CACHE = 'urbivue-shell-v1';

self.addEventListener('install', (event) => {
  // Precache the shell AND the assets index.html references — the first
  // page load happens before this worker controls the page, so waiting
  // for fetch events to populate the cache would need a second visit.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('/');
      await cache.put('/', res.clone());
      const html = await res.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // basemap tiles etc.
  if (url.pathname.startsWith('/api/')) return; // never cache data

  // Network-first with cache fallback: fresh when online, functional when not.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // SPA navigation fallback: serve the shell for unknown routes.
        if (event.request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
