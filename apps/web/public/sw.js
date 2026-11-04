/*
 * Bol-Bill service worker. Small and hand-written.
 *
 * What it does: keeps the app shell and static files so the app opens offline, and shows an
 * offline page when a page cannot be fetched and was never saved.
 *
 * What it must never do: touch the gateway. The gateway's traffic (POST /session, the
 * WebSocket, health and metrics) is never intercepted or stored: only same-origin GET requests
 * outside those paths are handled, and POST, WebSocket upgrades and cross-origin requests fall
 * straight through to the network.
 *
 * Releasing: change VERSION when the shell changes in a way network-first fetching would not
 * pick up; old caches are deleted on activation.
 */
const VERSION = 'v4';
const SHELL_CACHE = `bolbill-shell-${VERSION}`;
const ASSET_CACHE = `bolbill-assets-${VERSION}`;

const SHELL_PAGES = ['/', '/ledger', '/bills', '/catalog', '/settings'];
const SHELL_FILES = ['/offline.html', '/manifest.webmanifest'];
// Served from the asset cache (see the fetch handler), so they are saved there.
const ASSET_FILES = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/worklets/capture.js',
  '/worklets/playback.js',
];

// Paths that belong to the gateway when it is served from the same origin (production, behind Caddy).
const NEVER_CACHE = [/^\/session(\/|$)/, /^\/ws(\/|$)/, /^\/healthz/, /^\/metrics/, /^\/api\//];

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  await shell.addAll(SHELL_FILES);
  await assets.addAll(ASSET_FILES);
  // Fetch each page, keep it, and keep the hashed JS/CSS files it points to, so the pages work offline.
  for (const page of SHELL_PAGES) {
    const response = await fetch(page, { cache: 'reload' });
    if (!response.ok) throw new Error(`precache failed for ${page}`);
    const html = await response.clone().text();
    await shell.put(page, response);
    const files = new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || []);
    await Promise.all(
      [...files].map(async (file) => {
        if (await assets.match(file)) return;
        const r = await fetch(file);
        if (r.ok) await assets.put(file, r);
      }),
    );
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('bolbill-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function handled(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null; // includes a gateway on another origin
  if (request.headers.get('upgrade')) return null;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return null;
  return url;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = handled(request);
  if (url === null) return; // not ours: the browser goes to the network as usual

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE)); // content-hashed, immutable
  } else if (url.pathname.startsWith('/worklets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  } else {
    event.respondWith(networkFirst(request, request.mode === 'navigate'));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return hit || (await refresh) || Response.error();
}

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: !isNavigation });
    if (hit) return hit;
    if (isNavigation) {
      const offline = await cache.match('/offline.html');
      if (offline) return offline;
    }
    return Response.error();
  }
}
