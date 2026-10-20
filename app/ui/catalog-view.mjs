import { root, cloneTemplate, qs, qsa, esc } from './dom.mjs';
import { debounce } from '../core/utils.mjs';
import { attachHoverPreview } from './hover-preview.mjs';
import { prepareCatalogIndex } from '../core/catalog-index.mjs';
import { queryMyList } from '../core/my-list.mjs';

const titles = { live: 'TV ao vivo', vod: 'Filmes', series: 'Séries', radio: 'Rádio' };
const TV_EAGER_POSTERS = 8;
const TV_POSTER_BATCH = 4;
const TV_POSTER_BATCH_DELAY = 120;

function categoryButton(category, index) {
  const attributes = `data-category="${esc(category.id)}" title="${esc(category.name)}" aria-label="${esc(category.name)}" aria-pressed="${index === 0}"`;
  const active = index === 0 ? 'active' : '';
  return `<button class="${active}" ${attributes}>${esc(category.name)}</button>`;
}

function isSamsungTv() {
  return document.documentElement.classList.contains('tizen-tv');
}

function loadPosterImage(image) {
  const source = image?.dataset?.posterSrc;
  if (!source) return;
  delete image.dataset.posterSrc;
  image.src = source;
}

function cardKey(item) {
  return `${item.kind || 'content'}:${item.id || item.sourceId || item.name || ''}`;
}

function cardHtml(item, index) {
  const image = item.image || '';
  const secondary = item.rating ? `★ ${item.rating}` : (item.year || (item.kind === 'live' ? 'Canal' : item.kind === 'radio' ? 'Rádio' : 'Conteúdo'));
  const posterCard = ['vod', 'series'].includes(item.kind);
  const deferPoster = posterCard && isSamsungTv();
  const imageHtml = image
    ? `<img ${deferPoster ? `data-poster-src="${esc(image)}"` : `src="${esc(image)}" loading="lazy"`} alt="" decoding="async" referrerpolicy="no-referrer">`
    : `<span>${item.kind === 'radio' ? '◉' : item.kind === 'live' ? '▣' : '▶'}</span>`;
  return `<button class="item-card item-card-${esc(item.kind || 'content')} ${posterCard ? 'item-card-poster' : ''}" data-item-id="${esc(item.id)}" data-item-key="${esc(cardKey(item))}" data-page-index="${index}">
    <div class="poster">${imageHtml}</div>
    <div class="meta"><strong>${esc(item.name || 'Sem nome')}</strong>${posterCard ? '' : `<small>${esc(secondary)}</small>`}</div>
  </button>`;
}

function createCardElement(item, index) {
  const template = document.createElement('template');
  template.innerHTML = cardHtml(item, index);
  return template.content.firstElementChild;
}

export function renderCatalogView(kind, catalog, { pageSize = 120, onOpen, onPreview, ...previewOptions }) {
  root.replaceChildren(cloneTemplate('list-template'));
  qs('#content-title').textContent = titles[kind] || 'Conteúdo';
  const categories = [{ id: 'all', name: 'Todos' }, ...(catalog.categories || [])];
  const categoryList = qs('#category-list');
  categoryList.innerHTML = categories.map((category, index) => categoryButton(category, index)).join('');
  const grid = qs('#item-grid');
  grid.classList.add(`item-grid-${kind}`);
  const empty = qs('#empty-state');
  const loadMore = qs('#load-more');
  let selected = 'all';
  let term = '';
  let visible = pageSize;
  let filtered = [];
  let posterObserver = null;
  let posterQueue = [];
  let posterQueueTimer = null;
  let renderedPageSignature = '';
  let previousSearchCategory = '';
  let previousSearchTerm = '';
  let previousSearchEntries = [];
  let disposed = false;
  let detachObserver = null;
  const { categoryIndex } = prepareCatalogIndex(catalog.items);
  const hoverPreview = attachHoverPreview(grid, card => filtered[Number(card.dataset.pageIndex)], { ...previewOptions, onOpen, onPreview });

  function filteredEntries() {
    const lower = term.toLocaleLowerCase('pt-BR');
    const source = categoryIndex.get(selected) || [];
    if (!lower) {
      previousSearchCategory = selected;
      previousSearchTerm = '';
      previousSearchEntries = source;
      return source;
    }

    const canNarrowPrevious = previousSearchCategory === selected
      && previousSearchTerm
      && lower.startsWith(previousSearchTerm);
    const base = canNarrowPrevious ? previousSearchEntries : source;
    const result = base.filter(entry => entry.name.includes(lower));
    previousSearchCategory = selected;
    previousSearchTerm = lower;
    previousSearchEntries = result;
    return result;
  }

  function renderPage(page) {
    const signature = page.map(cardKey).join('\u001f');
    if (signature === renderedPageSignature) return false;

    hoverPreview.stop();
    if (!isSamsungTv()) {
      grid.innerHTML = page.map(cardHtml).join('');
      renderedPageSignature = signature;
      return true;
    }

    const reusable = new Map(
      [...grid.children]
        .filter(element => element.dataset?.itemKey)
        .map(element => [element.dataset.itemKey, element])
    );
    const fragment = document.createDocumentFragment();
    page.forEach((item, index) => {
      const key = cardKey(item);
      const existing = reusable.get(key);
      const card = existing || createCardElement(item, index);
      if (!card) return;
      card.dataset.pageIndex = String(index);
      fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);
    renderedPageSignature = signature;
    return true;
  }

  function flushPosterQueue() {
    if (disposed) return;
    posterQueueTimer = null;
    const batch = posterQueue.splice(0, TV_POSTER_BATCH);
    batch.forEach(image => {
      delete image.dataset.posterQueued;
      if (!image.isConnected) return;
      loadPosterImage(image);
      posterObserver?.unobserve(image);
    });
    if (posterQueue.length) posterQueueTimer = setTimeout(flushPosterQueue, TV_POSTER_BATCH_DELAY);
  }

  function queuePosterImage(image) {
    if (disposed || !image?.dataset?.posterSrc || image.dataset.posterQueued === '1') return;
    image.dataset.posterQueued = '1';
    posterQueue.push(image);
    if (!posterQueueTimer) posterQueueTimer = setTimeout(flushPosterQueue, TV_POSTER_BATCH_DELAY);
  }

  function observePosters({ reset = false } = {}) {
    if (disposed || !isSamsungTv()) return;
    if (reset && posterObserver) {
      posterObserver.disconnect();
      posterObserver = null;
    }
    if (reset) {
      if (posterQueueTimer) clearTimeout(posterQueueTimer);
      posterQueueTimer = null;
      posterQueue = [];
    }
    const pending = [...grid.querySelectorAll('img[data-poster-src]')];
    if (!pending.length) return;

    pending.slice(0, TV_EAGER_POSTERS).forEach(loadPosterImage);
    const deferred = pending.slice(TV_EAGER_POSTERS);
    if (!deferred.length) return;

    if ('IntersectionObserver' in window) {
      if (!posterObserver) {
        posterObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            queuePosterImage(entry.target);
          }
        }, {
          root: qs('.content-main'),
          rootMargin: '180px 0px',
          threshold: 0.01
        });
      }
      deferred.forEach(image => posterObserver.observe(image));
      return;
    }

    deferred.slice(0, TV_EAGER_POSTERS).forEach(loadPosterImage);
  }

  function update() {
    filtered = filteredEntries().map(entry => entry.item);
    const page = filtered.slice(0, visible);
    qs('#content-toolbar').textContent = `${filtered.length} itens${catalog.stale ? ' • cache desatualizado' : ''}`;
    const changed = renderPage(page);
    if (changed) observePosters({ reset: true });
    empty.classList.toggle('hidden', filtered.length > 0);
    loadMore.classList.toggle('hidden', visible >= filtered.length);
    loadMore.textContent = `Carregar mais (${Math.min(pageSize, Math.max(filtered.length - visible, 0))})`;
  }

  function appendMore() {
    hoverPreview.stop();
    const start = visible;
    visible += pageSize;
    const page = filtered.slice(start, visible);
    if (page.length) {
      grid.insertAdjacentHTML('beforeend', page.map((item, offset) => cardHtml(item, start + offset)).join(''));
      renderedPageSignature = filtered.slice(0, visible).map(cardKey).join('\u001f');
      observePosters();
    }
    loadMore.classList.toggle('hidden', visible >= filtered.length);
    loadMore.textContent = `Carregar mais (${Math.min(pageSize, Math.max(filtered.length - visible, 0))})`;
  }

  grid.onclick = event => {
    const button = event.target.closest('.item-card');
    if (!button || !grid.contains(button)) return;
    const item = filtered[Number(button.dataset.pageIndex)];
    if (item) { hoverPreview.stop(); onOpen(item); }
  };

  grid.addEventListener('focusin', event => {
    const image = event.target.closest('.item-card')?.querySelector('img[data-poster-src]');
    if (image) {
      if (image.dataset.posterQueued === '1') {
        posterQueue = posterQueue.filter(value => value !== image);
        delete image.dataset.posterQueued;
      }
      loadPosterImage(image);
      posterObserver?.unobserve(image);
    }
  });

  categoryList.onclick = event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    const nextSelected = button.dataset.category;
    if (nextSelected === selected) return;
    selected = nextSelected;
    visible = pageSize;
    qsa('[data-category]', categoryList).forEach(value => {
      value.classList.toggle('active', value === button);
      value.setAttribute('aria-pressed', String(value === button));
    });
    update();
  };
  const searchInput = qs('#search-input');
  const searchHandler = debounce(event => {
    const nextTerm = event.target.value;
    if (nextTerm === term) return;
    term = nextTerm;
    visible = pageSize;
    update();
  }, isSamsungTv() ? 280 : 200);
  searchInput.oninput = searchHandler;
  loadMore.onclick = appendMore;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hoverPreview.dispose();
    posterObserver?.disconnect();
    posterObserver = null;
    if (posterQueueTimer) clearTimeout(posterQueueTimer);
    posterQueueTimer = null;
    posterQueue.length = 0;
    searchHandler.cancel?.();
    detachObserver?.disconnect();
    detachObserver = null;
  };
  if (globalThis.MutationObserver) {
    detachObserver = new MutationObserver(() => {
      if (!grid.isConnected) dispose();
    });
    detachObserver.observe(root, { childList: true });
  }
  update();
}

export function renderFavoritesView(items, { pageSize = 120, onOpen, onPreview, history = [], accountId = '', profileId = '', ...previewOptions }) {
  root.replaceChildren(cloneTemplate('list-template'));
  qs('#content-title').textContent = 'Minha lista';
  qs('#category-list').innerHTML = '<p class="my-list-description">Seus filmes, séries, canais e rádios salvos.</p>';
  const toolbar = qs('#content-toolbar');
  toolbar.innerHTML = `<div class="my-list-controls">
    <label>Tipo<select data-list-kind><option value="all">Todos</option><option value="vod">Filmes</option><option value="series">Séries</option><option value="live">Canais</option><option value="radio">Rádios</option></select></label>
    <label>Progresso<select data-list-status><option value="all">Todos</option><option value="not-started">Não iniciados</option><option value="started">Iniciados</option></select></label>
    <label>Ordenar<select data-list-sort><option value="recent">Adicionados recentemente</option><option value="name">Nome: A–Z</option><option value="release">Ano de lançamento</option></select></label>
    <span data-list-count role="status"></span></div>`;
  const grid = qs('#item-grid');
  const input = qs('#search-input');
  const more = qs('#load-more');
  const empty = qs('#empty-state');
  let filtered = [];
  let shown = pageSize;
  let posterTimer = null;
  let posterQueue = [];
  empty.querySelector('span').textContent = 'Ajuste os filtros ou adicione títulos à Minha lista.';
  const hover = attachHoverPreview(grid, card => filtered[Number(card.dataset.pageIndex)], { ...previewOptions, onPreview, onOpen });
  function flushPosters() {
    posterTimer = null;
    if (!grid.isConnected) return;
    posterQueue.splice(0, TV_POSTER_BATCH).forEach(image => { if (image.isConnected) loadPosterImage(image); });
    if (posterQueue.length) posterTimer = setTimeout(flushPosters, TV_POSTER_BATCH_DELAY);
  }
  function render() {
    if (!grid.isConnected) return;
    hover.stop();
    clearTimeout(posterTimer);
    posterQueue = [];
    filtered = queryMyList(items, { kind: qs('[data-list-kind]', toolbar).value,
      status: qs('[data-list-status]', toolbar).value, sort: qs('[data-list-sort]', toolbar).value,
      term: input.value, history, accountId, profileId });
    grid.innerHTML = filtered.slice(0, shown).map(cardHtml).join('');
    posterQueue = qsa('img[data-poster-src]', grid);
    posterQueue.splice(0, TV_EAGER_POSTERS).forEach(loadPosterImage);
    if (posterQueue.length) posterTimer = setTimeout(flushPosters, TV_POSTER_BATCH_DELAY);
    qs('[data-list-count]', toolbar).textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'itens'}`;
    empty.classList.toggle('hidden', filtered.length > 0);
    more.classList.toggle('hidden', filtered.length <= shown);
    more.textContent = 'Carregar mais';
  }
  for (const select of qsa('select', toolbar)) select.onchange = () => { shown = pageSize; render(); };
  const search = debounce(() => { shown = pageSize; render(); }, 200);
  input.oninput = search;
  more.onclick = () => { shown += pageSize; render(); };
  grid.onclick = event => {
    const card = event.target.closest('.item-card');
    const item = card && filtered[Number(card.dataset.pageIndex)];
    if (item) { hover.stop(); onOpen?.(item); }
  };
  const observer = new MutationObserver(() => {
    if (grid.isConnected) return;
    hover.dispose(); search.cancel?.(); clearTimeout(posterTimer); posterQueue = []; observer.disconnect();
  });
  observer.observe(root, { childList: true });
  render();
}
