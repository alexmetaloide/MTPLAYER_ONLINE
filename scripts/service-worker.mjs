export function renderServiceWorker(version, files) {
  return `// Generated static shell only: never cache provider requests or credentials.
const CACHE = 'mtplayer-web-v2-${version}';
const FILES = ${JSON.stringify(files)};
const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // GitHub Pages assets have an HTTP cache lifetime. Never seed a new release
  // with old module bytes from that separate browser cache.
  await cache.addAll(FILES.map(file => new Request(new URL(file, self.registration.scope).href, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('mtplayer-web-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const home = new URL('./', self.registration.scope).href;
  if (event.request.mode === 'navigate' && (url.href === home || url.href === new URL('index.html', home).href)) {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match(new URL('index.html', home).href)));
  } else if (URLS.has(url.href)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(event.request)) || fetch(event.request))());
  }
});
`;
}
