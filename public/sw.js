// Service worker: makes the app installable and keeps the app shell available offline.
// App files are network-first (always fresh when online); CDN libraries and fonts are
// stale-while-revalidate. The API and map tiles are never cached.

const CACHE = 'passajh-v3';
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/city.js', '/js/mall.js', '/js/geo.js', '/js/ui.js', '/js/state.js',
  '/js/parking.js', '/js/shopping.js', '/js/friends.js', '/shared/catalog.js', '/shared/text.js', '/shared/frame.js',
  '/icon.svg', '/icon-192.png', '/manifest.webmanifest',
];
const CDN = ['https://unpkg.com/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
    return;
  }
  if (CDN.some((p) => req.url.startsWith(p))) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Tapping a notification (arrival, offer…) brings the app to the front.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((w) => 'focus' in w);
    return win ? win.focus() : self.clients.openWindow('/');
  }));
});
