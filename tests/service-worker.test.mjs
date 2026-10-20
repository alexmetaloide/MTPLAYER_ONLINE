import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderServiceWorker } from '../scripts/service-worker.mjs';

function worker() {
  const listeners = {};
  const requests = [];
  const removed = [];
  const cache = { addAll: async values => { requests.push(...values); } };
  const context = {
    URL, Request,
    self: {
      registration: { scope: 'https://example.com/MTPLAYER_ONLINE/' },
      location: { origin: 'https://example.com' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => {}, clients: { claim: async () => {} }
    },
    caches: {
      open: async () => cache,
      keys: async () => ['mtplayer-web-old', 'another-application'],
      delete: async key => { removed.push(key); }
    }
  };
  vm.runInNewContext(renderServiceWorker('revision', ['./index.html', './web/api.mjs']), context);
  const lifecycle = async name => {
    let completion;
    listeners[name]({ waitUntil: promise => { completion = promise; } });
    await completion;
  };
  return { listeners, requests, removed, lifecycle };
}

test('service worker: nova versão não reutiliza bytes do cache HTTP antigo', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(sw.requests.length, 2);
  assert.ok(sw.requests.every(request => request.cache === 'reload'));
  assert.equal(sw.requests[1].url, 'https://example.com/MTPLAYER_ONLINE/web/api.mjs');
});

test('service worker: atualização não remove caches de outros aplicativos', async () => {
  const sw = worker();
  await sw.lifecycle('activate');
  assert.deepEqual(sw.removed, ['mtplayer-web-old']);
});

test('service worker: não intercepta provedor, parâmetros privados ou endpoints fora da lista', () => {
  const sw = worker();
  for (const url of ['https://provider.example/stream.m3u8', 'https://example.com/MTPLAYER_ONLINE/index.html?token=private', 'https://example.com/MTPLAYER_ONLINE/player_api.php']) {
    let intercepted = false;
    sw.listeners.fetch({ request: { method: 'GET', url }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
