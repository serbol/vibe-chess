// Basic stale-while-revalidate service worker for the app shell and static assets.
// We don't try to be clever about Vite's hashed filenames — runtime caching picks
// them up the first time they're requested.
const CACHE = 'vibe-chess-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept the game's WebSocket / Socket.IO traffic.
  if (url.pathname.startsWith('/socket.io/')) return;
  // Skip cross-origin (e.g. the server's API on Render) — let the browser handle it.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((resp) => {
          if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
