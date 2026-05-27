const CACHE = 'babelchat-v1';

// On install: cache the app shell (just the root HTML)
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.add('/')));
  self.skipWaiting();
});

// On activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, cross-origin (CDN/APIs), and Firebase requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // Don't cache Cloudflare function API calls
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (SPA): network-first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
