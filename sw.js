const CACHE_NAME = 'trial-dynamic-v58';
const BASE = '/trial/';  // Match your GitHub Pages repo name

// Files that MUST be available offline immediately
const PRE_CACHE_ASSETS = [
    BASE + 'index.html',
    BASE + 'manifest.json',
    BASE + 'icon.png',
   
];

// Install: Cache essential files with error handling
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            try {
                // Try to cache each asset individually
                for (const asset of PRE_CACHE_ASSETS) {
                    try {
                        const response = await fetch(asset);
                        if (response.ok) {
                            await cache.put(asset, response);
                        }
                    } catch (err) {
                        console.log('Failed to cache:', asset, err);
                    }
                }
            } catch (err) {
                console.log('Cache error:', err);
            }
        })
    );
    self.skipWaiting();
});

// Activate: Clean up old cache versions
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            })
        ))
    );
    self.clients.claim();
});

// Fetch: Cache First, then Network
self.addEventListener('fetch', e => {
    // Handle share target POST request — must be checked BEFORE skipping non-GET
    const url = new URL(e.request.url);
    if (e.request.method === 'POST' && url.pathname.includes('share-target')) {
        e.respondWith(handleShareTarget(e.request));
        return;
    }

    // Skip non-GET requests
    if (e.request.method !== 'GET') return;
    
    // Skip cross-origin requests for better reliability
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.match(e.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(e.request).then(networkResponse => {
                // Only cache successful responses
                if (networkResponse && networkResponse.status === 200) {
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, networkResponse.clone());
                        return networkResponse;
                    });
                }
                return networkResponse;
            });
        }).catch(() => {
            // If offline and not in cache, return fallback for navigation
            if (e.request.mode === 'navigate') {
                return caches.match(BASE + 'index.html');
            }
            return new Response('Offline content not available', {
                status: 404,
                statusText: 'Not Found'
            });
        })
    );
});

// Share Target handler
async function handleShareTarget(request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (file && file instanceof File) {
            const arrayBuffer = await file.arrayBuffer();
            const base64 = bufferToBase64(arrayBuffer);

            const sharedPayload = JSON.stringify({
                name: file.name,
                type: file.type,
                data: base64,
                timestamp: Date.now()
            });

            // Use an absolute URL key so cache.match() always resolves correctly
            const sharedFileKey = self.location.origin + BASE + 'shared-file';
            const cache = await caches.open(CACHE_NAME);
            await cache.put(
                new Request(sharedFileKey),
                new Response(sharedPayload, { headers: { 'Content-Type': 'application/json' } })
            );

            // Notify any clients already open (foreground case)
            const clients = await self.clients.matchAll({ type: 'window' });
            for (const client of clients) {
                client.postMessage({
                    type: 'SHARED_FILE',
                    name: file.name,
                    fileType: file.type,
                    data: base64
                });
            }
        }
    } catch (err) {
        console.error('[SW] Share target error:', err);
    }

    // Redirect AFTER all async work is done
    return Response.redirect(BASE, 303);
}

// Utility: ArrayBuffer to base64
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// Listen for messages from clients to skip waiting
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
   
    if (event.data && event.data.type === 'GET_CACHE_NAME') {
    const replyPort = event.ports && event.ports[0];
    if (replyPort) {
        replyPort.postMessage({ type: 'CACHE_NAME', cacheName: CACHE_NAME, base: BASE }); // ← add base
    } else if (event.source) {
        event.source.postMessage({ type: 'CACHE_NAME', cacheName: CACHE_NAME, base: BASE });
    }
}
});
