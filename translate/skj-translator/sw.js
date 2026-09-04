// Keeps the app itself available with no connection. Model weights are not
// cached here — Transformers.js and Tesseract manage their own storage, and
// duplicating hundreds of megabytes would be careless.

// Bump this on every deploy or browsers keep serving the old app.
const VERSION = 'skj-translator-build-39';
const SHELL = `${VERSION}-shell`;
const LIBS = `${VERSION}-libs`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/config.js',
  './js/langs.js',
  './js/detect.js',
  './js/engine.js',
  './js/mt.remote.js',
  './js/budget.js',
  './js/asr.worker.js',
  './js/asr.native.js',
  './js/ocr.js',
  './js/audio.js',
  './js/tts.js',
  './js/store.js',
  './js/guide.js',
  './js/map.js',
  './js/today.js',
  './js/explore.js',
  './js/wikitext.js',
  './js/overpass.js',
  './js/guide.data.js',
  './js/phrases.js',
  './js/learn.js',
  './js/menu.data.js',
  './icons/icon.svg',
];

const LIB_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Library code: cache first, it is version-pinned and never changes.
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(LIBS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // Only cache real, readable responses. An opaque response has an
        // unreadable body and would break every later import from cache.
        if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Model weights and everything else cross-origin: straight to the network,
  // the libraries have their own caches.
  if (url.origin !== self.location.origin) return;

  // Never cache the translation endpoint.
  if (url.pathname.startsWith('/api/')) return;

  // App shell: network first so updates land, cache as the fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
