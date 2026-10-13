// Offline cache for the studio (network first, so new deploys show up immediately).
const CACHE = 'keypad-studio-v3';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'keys.js', 'schema.js', 'transport.js', 'designer.js', 'fx.js', 'macro-recorder.js', 'sound.js', 'ver.js', 'icons.js', 'icons/lucide.json', 'icons/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/fw/') || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
