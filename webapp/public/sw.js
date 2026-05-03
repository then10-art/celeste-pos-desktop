const CACHE_VERSION = 'v2';
const STATIC_CACHE = `celeste-pos-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `celeste-pos-dynamic-${CACHE_VERSION}`;
const MAX_DYNAMIC_ITEMS = 100;

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Asset extensions to cache dynamically
const CACHEABLE_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.webp'];

// Install: cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== DYNAMIC_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// Helper: is this a cacheable asset request?
function isCacheableAsset(url) {
  return CACHEABLE_EXTENSIONS.some(ext => url.includes(ext));
}

// Helper: trim dynamic cache to max size
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API/tRPC requests — these are handled by the app's offline logic
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.includes('/trpc/')) return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // Strategy for static assets (JS, CSS, images, fonts): Cache-first
  if (isCacheableAsset(url.pathname) || isCacheableAsset(url.href)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Return cached, but also update in background (stale-while-revalidate)
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) {
              caches.open(DYNAMIC_CACHE).then((cache) => {
                cache.put(request, response);
              });
            }
            return response.clone();
          }).catch(() => {});
          return cached;
        }
        // Not cached — fetch and cache
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, clone);
              trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
            });
          }
          return response;
        }).catch(() => {
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Strategy for navigation requests: Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // Return the cached index page for SPA routing
            return caches.match('/').then((index) => {
              if (index) return index;
              return new Response(
                `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Celeste POS - Offline</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1a365d;text-align:center}.c{max-width:400px;padding:2rem}h1{font-size:1.5rem}p{color:#64748b;margin:1rem 0}.btn{display:inline-block;padding:.75rem 1.5rem;background:#1a365d;color:white;border-radius:.5rem;text-decoration:none;margin-top:1rem;border:none;cursor:pointer;font-size:1rem}</style></head><body><div class="c"><h1>Sin Conexión</h1><p>No hay conexión a internet. Las ventas guardadas localmente se sincronizarán cuando se restaure la conexión.</p><button class="btn" onclick="location.reload()">Reintentar</button></div></body></html>`,
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
          });
        })
    );
    return;
  }

  // Default: Network-first for everything else
  event.respondWith(
    fetch(request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
