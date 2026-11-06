const CACHE = 'thabit-shell-v1';
const BASE_PATH = new URL('./', self.location).pathname;
const SHELL = [
  '', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icons.svg',
  'src/app.js', 'src/domain.js', 'src/storage.js'
].map(path => new URL(path, self.registration.scope).pathname);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(`${BASE_PATH}index.html`))));
});