// ─── Service Worker — Video Poker ───────────────────────────
// Strategy:
//   • index.html / navigations → NETWORK-FIRST WITH TIMEOUT: load the
//     newest deploy when online, but if the network hasn't answered
//     within NET_TIMEOUT_MS (weak signal, captive portal, iOS waking
//     up) serve the cached copy immediately. The network fetch keeps
//     running in the background so the cache still gets refreshed.
//   • everything else → STALE-WHILE-REVALIDATE: serve from cache
//     instantly, refresh the cache in the background.
// With this strategy new deploys show up on the next launch without
// bumping CACHE_NAME — the version only needs to change if you want to
// force-purge old cached entries.
// v7: all 54 strategy-data/*.json rewritten again — the re-absorption pass
// recovered 3.56 points across 41 tables, and the line labels now collapse
// repeated high-card variants into ranges ("4 to an outside straight: 0–3 high
// cards" instead of the same phrase four times). Those files are
// stale-while-revalidate, so without a purge a returning player keeps reading
// the old labels and the old lines — which is exactly what happened in
// testing, with a corrected file on disk and the stale one on screen.
// (v6 followed the earlier strategy regeneration; v5 the Super Double Double
// Bonus pay-table correction.)
const CACHE_NAME     = 'video-poker-v7';
const NET_TIMEOUT_MS = 3500;
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
    // Network-first with a timeout. The network promise is never aborted:
    // if the cache wins the race, the late network response still updates
    // the cache for next launch.
    const network = fetch(event.request, { cache: 'no-cache' }).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put('/index.html', clone.clone());
          cache.put('/', clone);
        });
      }
      return response;
    });
    const cached  = () => caches.match('/index.html').then(c => c || caches.match('/'));
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS));

    event.respondWith(
      Promise.race([network.catch(() => null), timeout]).then(response => {
        if (response) return response;                 // network answered in time
        return cached().then(c => c || network);       // offline/slow → cache; else wait
      })
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
