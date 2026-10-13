// Offline support. Network first (so updates show up on the next load), falling back to the cache
// when offline or when the network takes longer than NETWORK_TIMEOUT_MS.
const VERSION = 'tasklist-v3';
const NETWORK_TIMEOUT_MS = 3000;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'icons.js',
  'parser.js',
  'sync.js',
  'ai.js',
  'ai.css',
  'mindmap.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(req, cacheKey) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(cacheKey, copy)); }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // All page loads (including ./#add shortcuts) share one cached copy of the app shell.
  const key = req.mode === 'navigate' ? 'index.html' : req;
  event.respondWith(
    fromNetwork(req, key).catch(() => caches.match(key).then((cached) => cached || fetch(req)))
  );
});
