
const CACHE_NAME = 'somap-cache-v1';

// Static assets (safe to cache)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/firebase.js'
];

// Install: cache core shell only
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetching strategy
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore the non-GET
  if (req.method !== 'GET') return;

  // NEVER cache Firebase or auth calls
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('identitytoolkit')
  ) {
    return; // allow normal network behavior
  }

  // Cloudinary PDFs & images → CACHE FIRST
  if (url.hostname.includes('res.cloudinary.com')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  //Static site assets → NETWORK FIRST (fallback to cache)
  event.respondWith(networkFirst(req));
});

/* ------- Strategies --------- */

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    cache.put(req, fresh.clone());
  }
  return fresh;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}
