/**
 * The static site's service worker (openspec offline-app). Registered by the app only while Use
 * offline is on, after a complete download. It answers the site's own requests from the downloaded
 * copy of one version (the cache `vexiq-offline-<version>` the active pointer names), so offline the
 * whole site is one version. Everything else goes to the network: the version check's
 * `offline-manifest.json`, and the downloader's own requests (marked with DOWNLOAD_HEADER), which
 * must get the published files, not the copy. The app switches versions with an `activate-version`
 * message once a new copy is complete; this worker never moves to a new version by itself.
 */
const CACHE_PREFIX = 'vexiq-offline-';
const ACTIVE_CACHE = 'vexiq-offline-active';
const scope = self.registration.scope; // ends with '/'
const ACTIVE_KEY = `${scope}__active__`;
const DOWNLOAD_HEADER = 'x-vexiq-offline-download'; // set by src/offline/download.js

let active = null; // the active version's cache name, read once and kept

async function activeCacheName() {
  if (active) return active;
  const pointer = await (await caches.open(ACTIVE_CACHE)).match(ACTIVE_KEY);
  active = pointer ? await pointer.text() : null;
  return active;
}

self.addEventListener('install', () => {
  // Nothing to fetch: the app downloaded the copy before registering this worker. A newer sw.js
  // takes over at once; it serves the same active version, so the site doesn't change under the page.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take over the open page, so parts it hasn't loaded yet come from the copy
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope) || request.headers.has(DOWNLOAD_HEADER)) return;
  const rel = request.url.slice(scope.length).split(/[?#]/)[0];
  if (rel === 'offline-manifest.json' || rel === 'sw.js') return;
  event.respondWith(
    (async () => {
      const name = await activeCacheName();
      const cache = name && (await caches.open(name));
      // Every page inside the site is the app's one page
      const hit = cache && (await cache.match(request.mode === 'navigate' ? `${scope}index.html` : request, { ignoreSearch: true }));
      return hit ?? fetch(request);
    })()
  );
});

self.addEventListener('message', (event) => {
  const { type, version } = event.data ?? {};
  if (type !== 'activate-version') return;
  const reply = (msg) => event.ports[0]?.postMessage(msg);
  event.waitUntil(
    (async () => {
      const name = `${CACHE_PREFIX}${version}`;
      const complete = await (await caches.open(name)).match(`${scope}__complete__`);
      if (!complete) return reply({ ok: false, error: 'That version is not fully downloaded' });
      await (await caches.open(ACTIVE_CACHE)).put(ACTIVE_KEY, new Response(name));
      active = name;
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== name && key !== ACTIVE_CACHE) await caches.delete(key);
      }
      reply({ ok: true });
    })()
  );
});
