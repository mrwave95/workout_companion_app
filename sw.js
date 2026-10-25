// Scope the cache to this installation: GitHub Pages apps can share an origin.
const CACHE_PREFIX = `racked:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const SHELL_URL = new URL('index.html', self.registration.scope).href;
const ASSETS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png']
  .map(path => new URL(path, self.registration.scope).href);
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
  // Legacy racked-cache-v* names were shared across paths. Their ownership is
  // ambiguous, so leave them (and other apps' caches) alone during this upgrade.
});

async function networkFirst(network, cacheKey) {
  const cached = await caches.open(CACHE_NAME)
    .then(cache => cache.match(cacheKey)).catch(() => undefined);
  let timeout;
  try {
    // Prefer fresh content. On a stalled connection, a previously cached copy
    // can render after the deadline while the network still refreshes the cache.
    const response = cached ? await Promise.race([
      network,
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); })
    ]) : await network;
    if (response && (response.ok || !cached)) return response;
    return cached;
  } catch (_) {
    return cached || new Response('Racked is offline. Connect once to cache the app.', {
      status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}
    });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  url.search = ''; url.hash = '';
  // Both launch URLs share one shell, including URLs with tracking parameters.
  const cacheKey = url.href === self.registration.scope ? SHELL_URL : url.href;
  if (!ASSETS.includes(cacheKey)) return;

  const network = fetch(request, {cache: 'no-cache'});
  event.waitUntil(network.then(response => {
    // Never replace a good offline copy with an error, redirect, or partial body.
    if (response.status !== 200 || response.redirected || response.type === 'opaque') return;
    const copy = response.clone();
    return caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
  }).catch(() => { /* Cache quota failures must not break an online response. */ }));
  event.respondWith(networkFirst(network, cacheKey));
});
