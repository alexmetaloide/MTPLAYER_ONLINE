// Load each playback engine only when a stream needs it. The shared promise
// prevents duplicate script elements during concurrent previews/playback.
const pending = new Map();

const engines = {
  hls: { globalName: 'Hls', path: '../vendor/hls.min.js' },
  ts: { globalName: 'mpegts', path: '../vendor/mpegts.js' }
};

export function ensureMediaEngine(kind) {
  const engine = engines[kind];
  if (!engine) return Promise.reject(new Error('Motor de vídeo desconhecido.'));
  if (globalThis[engine.globalName]) return Promise.resolve(globalThis[engine.globalName]);
  if (pending.has(kind)) return pending.get(kind);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = new URL(engine.path, import.meta.url).href;
    script.onload = () => globalThis[engine.globalName]
      ? resolve(globalThis[engine.globalName])
      : reject(new Error(`Motor de vídeo indisponível: ${kind}`));
    script.onerror = () => {
      script.remove();
      reject(new Error(`Falha ao carregar o motor de vídeo: ${kind}`));
    };
    (document.head || document.body).appendChild(script);
  }).finally(() => {
    pending.delete(kind);
  });
  pending.set(kind, promise);
  return promise;
}
