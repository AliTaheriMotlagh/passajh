// Service worker: makes the app installable and usable offline or on a bad connection.
// App files are network-first (fresh when online, cached copy when not); the self-hosted font and map
// library never change at a given path, so they're cache-first. The app keeps its own copy of the data
// (see js/data.js), so the API isn't cached here. Map tiles aren't cached.

const CACHE = 'passajh-v5';
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/geo.js', '/js/data.js', '/js/nav.js', '/js/parts.js', '/js/forms.js', '/js/plan.js',
  '/js/views/home.js', '/js/views/find.js', '/js/views/mall.js', '/js/views/map.js', '/js/views/list.js', '/js/views/me.js',
  '/shared/catalog.js', '/shared/text.js', '/shared/floors.js',
  '/fonts/vazirmatn-33.0.3.woff2', '/icon.svg', '/icon-192.png', '/manifest.webmanifest',
];

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
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (/^\/(vendor|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
