/*
 * Service Worker for Big M Compass
 *
 * This service worker implements a basic offline strategy: cache the app shell
 * during installation and serve it from the cache for navigations. Static
 * assets are served cache‑first. Cross‑origin requests (e.g. the Overpass API)
 * always go through the network with no caching, because caching dynamic
 * results can be brittle and stale. The service worker also cleans up old
 * caches on activation.
 */

const CACHE_NAME = 'bigm-compass-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/service-worker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  // Precache the application shell
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Remove older caches
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Same‑origin requests
  if (url.origin === location.origin) {
    // HTML navigations: try network first to ensure freshness, fall back to cache
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', clone));
          return response;
        }).catch(() => caches.match('/') || caches.match('/index.html'))
      );
      return;
    }
    // Other assets: cache first, then network
    event.respondWith(
      caches.match(request).then(cached => {
        return cached || fetch(request).then(resp => {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, respClone));
          return resp;
        });
      })
    );
  } else {
    // Cross‑origin fetches (e.g. Overpass API): network only
    event.respondWith(
      fetch(request).catch(() => {
        // When offline, respond with a generic failure response. The app will
        // display a cached result if available.
        return new Response('', { status: 503, statusText: 'Offline' });
      })
    );
  }
});