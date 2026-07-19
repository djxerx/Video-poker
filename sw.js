// ─── Service Worker — Video Poker ───────────────────────────
// Strategy:
//   • index.html / navigations → NETWORK-FIRST: always load the newest
//     deploy when online; fall back to the cached copy offline.
//   • everything else → STALE-WHILE-REVALIDATE: serve from cache
//     instantly, refresh the cache in the background.
// With this strategy new deploys show up on the next launch without
// bumping CACHE_NAME — the version only needs to change if you want to
// force-purge old cached entries.
const CACHE_NAME = 'video-poker-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: pre-cache all assets, bypassing the HTTP cache so the
// precache never captures a stale copy
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: purge old caches, take control of open pages immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate' ||
                       url.pathname === '/' || url.pathname === '/index.html';

  if (isNavigation) {
    // Network-first: newest version whenever online
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put('/index.html', clone.clone());
            cache.put('/', clone);
          });
        }
        return response;
      }).catch(() =>
        caches.match('/index.html').then(c => c || caches.match('/'))
      )
    );
    return;
  }

  // Stale-while-revalidate for all other same-origin assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);   // offline: fall back to cache (or fail)
      return cached || network;
    })
  );
});
