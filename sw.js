// sw.js — service worker for the Performance Evaluation PWA
//
// Two jobs:
// 1. Basic app-shell caching so the app can install and reopen offline.
// 2. Intercept the POST navigation that the OS share sheet sends when a
//    .json report is shared to this app (Web Share Target API). Since this
//    is a static site with no backend, the "receiving" has to happen here,
//    entirely on the visitor's device — we grab the file out of the POST
//    body, stash it in Cache Storage, and redirect to a normal GET so the
//    page can pick it up on load (see checkSharedReport() in index.html).

const CACHE_NAME = 'pms-shell-v1';
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== 'share-target-cache')
            .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ── Share target: intercept the POST the share sheet sends ──
  if (req.method === 'POST' && url.pathname.endsWith('/index.html')) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // ── Normal navigation/app-shell: cache-first, fall back to network ──
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const file = formData.get('reportfile');
    const text = file ? await file.text() : '';
    const cache = await caches.open('share-target-cache');
    await cache.put('/shared-report', new Response(text));
  } catch (err) {
    // If parsing the incoming share fails, we still redirect — the page
    // will simply find nothing in the cache and do nothing, no crash.
    console.warn('share-target handling failed', err);
  }
  return Response.redirect('./index.html?shared=1', 303);
}
