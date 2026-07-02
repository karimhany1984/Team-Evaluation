const CACHE_NAME = 'pms-shell-v5';
const BASE = '/Team-Evaluation/';

const PRE_CACHE_ASSETS = [
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'icon-512-maskable.png'
];

// Install: cache each asset individually so one missing/failed file
// doesn't take down the whole precache (cache.addAll fails atomically).
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of PRE_CACHE_ASSETS) {
        try {
          const response = await fetch(asset);
          if (response.ok) await cache.put(asset, response);
        } catch (err) {
          console.log('Failed to cache:', asset, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate: drop old shell caches, but never touch the share-target cache.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== 'share-target-cache')
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Share target: check this BEFORE the GET-only filter, since shares
  // arrive as POST.
  if (e.request.method === 'POST' && url.pathname.includes('share-target')) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            // Clone IMMEDIATELY, before doing anything else with networkResponse.
            // Cloning after the original body may have started being read
            // (e.g. once we return it below and the browser starts piping it)
            // throws "Failed to execute 'clone' on 'Response': Response body
            // is already used". Cloning first avoids that race entirely.
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => {
          if (e.request.mode === 'navigate') {
            return caches.match(BASE + 'index.html');
          }
          return new Response('Offline content not available', { status: 404, statusText: 'Not Found' });
        });
    })
  );
});

// Share Target handler — receives the shared .json report file.
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('reportfile');

    if (file) {
      const text = await file.text();
      const sharedFileKey = self.location.origin + BASE + 'shared-report';
      const cache = await caches.open('share-target-cache');
      await cache.put(new Request(sharedFileKey), new Response(text, { headers: { 'Content-Type': 'application/json' } }));

      // Foreground case: if the app is already open, tell it directly too,
      // in addition to the cache (belt-and-suspenders — the redirect below
      // covers the case where it isn't already open).
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'SHARED_REPORT', data: text });
      }
    }
  } catch (err) {
    console.error('[SW] Share target error:', err);
  }

  return Response.redirect(BASE, 303);
}

// Optional update-management hooks (from the reference file) — lets a page
// force an update or ask which cache version is active. Not required for
// the core features you asked for, included for parity/future use.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_CACHE_NAME') {
    const replyPort = event.ports && event.ports[0];
    const payload = { type: 'CACHE_NAME', cacheName: CACHE_NAME, base: BASE };
    if (replyPort) replyPort.postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
  }
});
