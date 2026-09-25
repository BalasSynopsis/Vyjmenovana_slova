/* Service worker.
   - App files (html/js/css/json): network-first, so updates arrive as soon as the phone is online; cached copy offline.
   - Media (images, audio, fonts): cache-first.
   Asset list + version come from precache-manifest.js (regenerate with: python3 tools/precache.py). */
importScripts('precache-manifest.js');   // defines self.PRECACHE = { version, files }
const CACHE = 'expedice-' + self.PRECACHE.version;

self.addEventListener('install', e => {
  // cache:'reload' bypasses the browser's HTTP cache so we never precache a stale file
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(self.PRECACHE.files.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('expedice-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const isMedia = u => /\.(webp|png|jpg|mp3|woff2)$/i.test(u.pathname);
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (isMedia(u)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    })));
  } else {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
  }
});
