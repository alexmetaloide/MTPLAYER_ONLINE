import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'app');
const out = path.join(root, 'dist');
async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${relative}`);
    if (entry.isDirectory()) result.push(...await inventory(path.join(directory, entry.name), `${relative}/`));
    else result.push(relative);
  }
  return result.sort();
}
const files = await inventory(source);
if (files.some(file => /\.(?:exe|dll|cjs|m3u|m3u8)$/i.test(file) || /(?:^|\/)(?:accounts|cache|\.env)(?:[./-]|$)/i.test(file))) {
  throw new Error('A publicação contém um arquivo que não pertence ao webapp.');
}
const hash = createHash('sha256');
for (const file of files) { hash.update(file); hash.update(await readFile(path.join(source, file))); }
const version = hash.digest('hex').slice(0, 16);
// Only this build-owned output is replaced, never the app sources or user data.
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(source, out, { recursive: true });
await writeFile(path.join(out, '.nojekyll'), '');
const precache = files.map(file => `./${file}`);
await writeFile(path.join(out, 'sw.js'), `// Generated static shell only: never cache provider requests or credentials.
const CACHE = 'mtplayer-web-${version}';
const FILES = ${JSON.stringify(precache)};
const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES.map(file => new URL(file, self.registration.scope).href));
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
`);
console.log(`MTPLAYER Web: ${files.length} arquivos, versão ${version}. Saída: dist/`);
