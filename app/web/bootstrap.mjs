import { createWebAPI } from './api.mjs';
import { createFileAPI } from './files.mjs';

try {
  // Verify both stores before the original renderer starts.
  for (const store of [localStorage, sessionStorage]) {
    store.setItem('mtplayer-storage-probe', '1');
    store.removeItem('mtplayer-storage-probe');
  }
  globalThis.desktopAPI = Object.freeze({ ...createWebAPI(), backup: createFileAPI() });
  document.documentElement.classList.add('web-app');
  await import('../app.mjs');
  if ('serviceWorker' in navigator && globalThis.isSecureContext) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
      .catch(() => {}); // The online app also works without service-worker support.
  }
} catch {
  const message = document.createElement('p');
  message.className = 'web-fatal';
  message.textContent = 'Não foi possível iniciar o MTPLAYER Web. Permita armazenamento neste site e abra pelo endereço HTTPS (ou localhost), não pelo arquivo index.html.';
  document.getElementById('view-root').replaceChildren(message);
}
