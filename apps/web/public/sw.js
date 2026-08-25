/* Outfox service worker (DESIGN-SYSTEM-WEB §1.1). Precache the app shell only; API
   responses are NEVER cached (server-authoritative economy). Offline = read-only shell;
   the app renders TAPE HALTED because /api calls fail, not because the SW serves stale
   money state. Update flow supports a forced path (skipWaiting on message) so a
   /min-version bump can't loop on the old precached shell. */
const SHELL = 'outfox-shell-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)));
  // do NOT auto-skipWaiting: the client confirms (polite path) or forces via message
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting(); // forced-update path (§1.1)
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // never cache mutations
  if (url.pathname.startsWith('/api/')) return; // API is network-only, uncached
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the precached shell (offline boot works).
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Hashed static assets: cache-first (immutable), fall back to network.
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      }),
    ),
  );
});
