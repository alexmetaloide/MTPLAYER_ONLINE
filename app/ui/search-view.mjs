import { root, cloneTemplate, qs, qsa, esc } from './dom.mjs';
import { searchStreamingCatalog } from '../core/streaming-hub.mjs';

const PAGE_SIZE = 48;

function card(item, index) {
  const image = item.image || item.backdrop || '';
  return `<button class="hub-card search-result-card" data-search-result="${index}" title="${esc(item.name)}">
    <span class="hub-poster">${image ? `<img src="${esc(image)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="">` : '<span class="hub-placeholder">▶</span>'}
      <small>${item.kind === 'vod' ? 'FILME' : 'SÉRIE'}</small></span>
    <span class="hub-card-title">${esc(item.name)}</span>
  </button>`;
}

/** Renders the current account/profile catalog; no remote search endpoint or tracking. */
export function renderSearchView(catalogs, { onOpen, initialTerm = '' } = {}) {
  root.replaceChildren(cloneTemplate('global-search-template'));
  const input = qs('#global-search-input');
  const grid = qs('#global-search-grid');
  const status = qs('#global-search-status');
  const empty = qs('#global-search-empty');
  const more = qs('#global-search-more');
  let selectedKind = 'all';
  let shown = PAGE_SIZE;
  let displayed = [];
  let debounceTimer = null;

  function render() {
    if (!root.contains(input)) return;
    const result = searchStreamingCatalog(catalogs, input.value, { kind: selectedKind, limit: shown });
    displayed = result.items;
    grid.innerHTML = displayed.map(card).join('');
    status.textContent = result.total ? `${result.total.toLocaleString('pt-BR')} ${result.total === 1 ? 'título encontrado' : 'títulos encontrados'}` : 'Nenhum título encontrado';
    empty.classList.toggle('hidden', result.total > 0);
    more.classList.toggle('hidden', result.total <= displayed.length);
    qsa('[data-search-kind]', root).forEach(button => {
      const active = button.dataset.searchKind === selectedKind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  input.value = initialTerm;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    shown = PAGE_SIZE;
    debounceTimer = setTimeout(render, 200);
  });
  qsa('[data-search-kind]', root).forEach(button => {
    button.onclick = () => { selectedKind = button.dataset.searchKind; shown = PAGE_SIZE; render(); };
  });
  more.onclick = () => { shown += PAGE_SIZE; render(); };
  grid.onclick = event => {
    const button = event.target.closest('[data-search-result]');
    const item = button ? displayed[Number(button.dataset.searchResult)] : null;
    if (item) onOpen?.(item);
  };
  render();
  if (!document.documentElement.classList.contains('tizen-tv')) input.focus({ preventScroll: true });
}
