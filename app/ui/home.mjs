import { root, cloneTemplate, qs, qsa, esc } from './dom.mjs';
import { continueWatching, historyProgressPercent, formatPlaybackTime } from '../core/history.mjs';

const statusLabels = {
  disconnected: 'Sem conta conectada',
  configured: 'Conta configurada',
  connecting: 'Conectando...',
  online: 'Servidor online',
  offline: 'Servidor indisponível',
  authentication_error: 'Falha de autenticação'
};

const TV_HOME_EAGER_POSTERS = 3;
const TV_HOME_POSTER_BATCH = 2;
const TV_HOME_POSTER_DELAY = 140;

function isSamsungTv() {
  return document.documentElement.classList.contains('tizen-tv');
}

function continueCard(entry, index) {
  const percent = historyProgressPercent(entry);
  const image = entry.item.image || '';
  const detail = entry.duration
    ? `${formatPlaybackTime(entry.position)} de ${formatPlaybackTime(entry.duration)}`
    : `Assistido por ${formatPlaybackTime(entry.position)}`;
  const deferPoster = isSamsungTv() && index >= TV_HOME_EAGER_POSTERS;
  const episode = entry.item.kind === 'series' ? [entry.item.season && `T${entry.item.season}`, entry.item.episode && `E${entry.item.episode}`].filter(Boolean).join(' • ') : '';
  return `<article class="continue-card"><button class="continue-open" data-continue-index="${index}">
    <div class="continue-poster">
      ${image ? `<img ${deferPoster ? `data-home-poster-src="${esc(image)}"` : `src="${esc(image)}" loading="lazy"`} alt="" decoding="async" referrerpolicy="no-referrer">` : '<span>▶</span>'}
      <div class="continue-progress"><i style="width:${percent}%"></i></div>
    </div>
    <div class="continue-meta"><strong>${esc(entry.item.seriesName || entry.item.name || 'Conteúdo')}</strong><small>${esc([episode, detail].filter(Boolean).join(' • '))}</small></div>
  </button><button class="continue-remove" data-continue-remove="${index}" aria-label="Remover ${esc(entry.item.seriesName || entry.item.name)} de Continuar assistindo">× Remover da faixa</button></article>`;
}

function recommendationCard(item, index, kind) {
  const image = item.image || item.backdrop || '';
  const deferPoster = isSamsungTv() && index >= TV_HOME_EAGER_POSTERS;
  return `<button class="recommendation-card" data-recommend-kind="${kind}" data-recommend-index="${index}" title="${esc(item.name)}">
    <div class="recommendation-poster">
      ${image ? `<img ${deferPoster ? `data-home-poster-src="${esc(image)}"` : `src="${esc(image)}" loading="lazy"`} alt="" decoding="async" referrerpolicy="no-referrer">` : '<span>▶</span>'}
      <span class="recommendation-type">${kind === 'vod' ? 'FILME' : 'SÉRIE'}</span>
    </div>
    <span class="recommendation-info"><strong>${esc(item.name)}</strong><small>${esc(item.recommendationReason || 'Para descobrir')}</small></span>
  </button>`;
}

function renderStreamingHub(hub, callbacks, isInList) {
  if (!hub) return;
  const featured = qs('#hub-featured');
  const collections = qs('#hub-collections');
  const rows = [
    ['myList', 'Minha lista', 'TÍTULOS QUE VOCÊ SALVOU'],
    ['newArrivals', 'Novidades do catálogo', 'ADICIONADOS PELO PROVEDOR'],
    ['watchAgain', 'Assistir novamente', 'VOCÊ JÁ ASSISTIU'],
    ['highlights', 'Destaques para explorar', 'SUGESTÕES DO CATÁLOGO'],
    ['seriesPicks', 'Séries para descobrir', 'EXPLORE MAIS SÉRIES']
  ];

  if (hub.featured) {
    const item = hub.featured;
    const image = item.backdrop || item.image || '';
    featured.classList.remove('hidden');
    featured.innerHTML = `${image ? `<img class="hub-featured-image" src="${esc(image)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="">` : ''}
      <div class="hub-featured-content"><span class="eyebrow">EM DESTAQUE NO SEU CATÁLOGO</span>
      <h2>${esc(item.name)}</h2><p>${esc([item.kind === 'vod' ? 'Filme' : 'Série', item.year, item.genre].filter(Boolean).join(' • '))}</p>
      <div class="hub-featured-actions"><button class="hub-primary-btn" data-hub-feature="watch">▶ Ver detalhes</button>
      <button class="hub-secondary-btn" data-hub-feature="list">${isInList(item) ? '✓ Na minha lista' : '＋ Minha lista'}</button>
      <button class="hub-secondary-btn" data-view="search">⌕ Buscar</button></div></div>`;
    featured.querySelector('[data-hub-feature="watch"]').onclick = () => callbacks.onHubOpen?.(item);
    featured.querySelector('[data-hub-feature="list"]').onclick = () => callbacks.onHubFavorite?.(item);
  }

  const itemIndex = new Map();
  collections.innerHTML = rows.filter(([key]) => hub[key]?.length).map(([key, title, eyebrow]) => {
    const tiles = hub[key].map((item, index) => {
      const identifier = `${key}:${index}`;
      itemIndex.set(identifier, item);
      const image = item.image || item.backdrop || '';
      return `<div class="hub-tile"><button class="hub-card" data-hub-item="${identifier}" title="${esc(item.name)}">
        <span class="hub-poster">${image ? `<img src="${esc(image)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="">` : '<span class="hub-placeholder">▶</span>'}
          <small>${item.kind === 'vod' ? 'FILME' : 'SÉRIE'}</small></span>
        <span class="hub-card-title">${esc(item.name)}</span></button>
        <button class="hub-list-mini" data-hub-list="${identifier}" aria-label="${isInList(item) ? 'Remover de Minha lista' : 'Adicionar à Minha lista'}: ${esc(item.name)}" title="${isInList(item) ? 'Remover de Minha lista' : 'Adicionar à Minha lista'}">${isInList(item) ? '✓' : '＋'}</button></div>`;
    }).join('');
    return `<section class="hub-row" aria-label="${title}"><div class="hub-row-head"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>
      <div class="hub-row-controls"><button data-hub-scroll="left" aria-label="Rolar ${title} para a esquerda">‹</button>
      <button data-hub-scroll="right" aria-label="Rolar ${title} para a direita">›</button></div></div><div class="hub-rail">${tiles}</div></section>`;
  }).join('');
  collections.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    const key = button.dataset.hubItem || button.dataset.hubList;
    if (key && itemIndex.has(key)) {
      if (button.dataset.hubItem) callbacks.onHubOpen?.(itemIndex.get(key));
      else callbacks.onHubFavorite?.(itemIndex.get(key));
      return;
    }
    if (button.dataset.hubScroll) {
      const rail = button.closest('.hub-row')?.querySelector('.hub-rail');
      if (rail) rail.scrollBy({ left: (button.dataset.hubScroll === 'left' ? -1 : 1) * Math.max(300, rail.clientWidth * 0.8), behavior: 'smooth' });
    }
  };
}

/** Refresh just the collection rails after changing a favorite. */
export function updateHomeHub(hub, callbacks = {}) {
  const home = root.querySelector('.home-view');
  if (!home) return false;
  const rails = new Map([...home.querySelectorAll('.hub-row')].map(row => [
    row.getAttribute('aria-label'), row.querySelector('.hub-rail')?.scrollLeft || 0
  ]));
  const focused = home.contains(document.activeElement) ? document.activeElement : null;
  const focusRow = focused?.closest('.hub-row')?.getAttribute('aria-label');
  const focusKey = focused?.dataset.hubItem || focused?.dataset.hubList;
  const focusType = focused?.dataset.hubItem ? 'hubItem' : 'hubList';
  renderStreamingHub(hub, callbacks, callbacks.isInList || (() => false));
  for (const row of home.querySelectorAll('.hub-row')) {
    const left = rails.get(row.getAttribute('aria-label'));
    if (left != null) row.querySelector('.hub-rail').scrollLeft = left;
  }
  if (focusRow && focusKey) {
    const row = [...home.querySelectorAll('.hub-row')]
      .find(entry => entry.getAttribute('aria-label') === focusRow);
    const button = [...(row?.querySelectorAll('button') || [])]
      .find(entry => entry.dataset[focusType] === focusKey);
    button?.focus({ preventScroll: true });
  }
  return true;
}

/** Refresh status and counters without replacing posters, rails or scroll positions. */
export function updateHomeIndicators(state) {
  const home = root.querySelector('.home-view');
  if (!home) return false;
  home.querySelector('#connection-status').textContent = statusLabels[state.accountState] || statusLabels.configured;
  home.querySelector('.status-dot').classList.toggle('online', state.accountState === 'online');
  home.querySelector('#live-count').textContent = `${state.summary.live || 0} canais`;
  home.querySelector('#vod-count').textContent = `${state.summary.vod || 0} títulos`;
  home.querySelector('#series-count').textContent = `${state.summary.series || 0} séries`;
  const radio = home.querySelector('#radio-count');
  if (radio) radio.textContent = `${state.summary.radio || 0} estações`;
  return true;
}

export function renderHome(state, { onContinue, onContinueRemove, onRecommendation, onHubOpen, onHubFavorite, isInList } = {}) {
  root.replaceChildren(cloneTemplate('home-template'));
  const connected = Boolean(state.activeAccount);
  qs('#home-account-label').textContent = connected
    ? `${state.activeProfile?.name ? `${state.activeProfile.name} • ` : ''}${state.activeAccount.name} • ${state.activeAccount.type === 'xtream' ? 'Xtream Codes' : 'M3U'}`
    : 'Configure sua conta para começar.';
  updateHomeIndicators(state);

  const entries = continueWatching(state.history, state.activeAccount?.id, 8, state.activeProfile?.id || '');
  const section = qs('#continue-section');
  const grid = qs('#continue-grid');
  if (section && grid && entries.length) {
    section.classList.remove('hidden');
    grid.innerHTML = entries.map(continueCard).join('');
    qsa('[data-continue-index]', grid).forEach(button => {
      button.onclick = () => onContinue?.(entries[Number(button.dataset.continueIndex)]);
    });
    qsa('[data-continue-remove]', grid).forEach(button => {
      button.onclick = () => onContinueRemove?.(entries[Number(button.dataset.continueRemove)]);
    });
  }

  const suggestions = state.recommendations || {};
  renderStreamingHub(state.streamingHub, { onHubOpen, onHubFavorite }, isInList || (() => false));
  const suggestionSection = qs('#recommendations-section');
  if (suggestionSection && (suggestions.watchedCount || suggestions.ratedCount)) {
    suggestionSection.classList.remove('hidden');
    let shown = 0;
    for (const [kind, id] of [['vod', 'recommendations-movies'], ['series', 'recommendations-series']]) {
      const items = suggestions[kind] || [];
      const group = qs(`#${id}`);
      if (!group || !items.length) continue;
      group.classList.remove('hidden');
      const recommendationGrid = group.querySelector('.recommendations-grid');
      recommendationGrid.innerHTML = items.map((item, index) => recommendationCard(item, index, kind)).join('');
      qsa('[data-recommend-index]', recommendationGrid).forEach(button => {
        button.onclick = () => onRecommendation?.(items[Number(button.dataset.recommendIndex)]);
      });
      shown += items.length;
    }
    if (!shown) {
      const message = qs('#recommendations-message');
      message.classList.remove('hidden');
      message.textContent = state.recommendationsError
        ? 'Não foi possível carregar filmes e séries. Verifique sua conexão e use Atualizar.'
        : state.catalogs.vod.loaded || state.catalogs.series.loaded
        ? 'Ainda não há títulos disponíveis para recomendar. Atualize seu catálogo.'
        : 'Analisando seu histórico e preparando sugestões…';
    }
  }

  if (isSamsungTv()) {
    const deferred = qsa('img[data-home-poster-src]', root);
    const loadBatch = () => {
      if (!root.querySelector('.home-view')) {
        deferred.length = 0;
        return;
      }
      deferred.splice(0, TV_HOME_POSTER_BATCH).forEach(image => {
        if (!image.isConnected) return;
        const source = image.dataset.homePosterSrc;
        delete image.dataset.homePosterSrc;
        if (source) image.src = source;
      });
      if (deferred.length) setTimeout(loadBatch, TV_HOME_POSTER_DELAY);
    };
    if (deferred.length) setTimeout(loadBatch, TV_HOME_POSTER_DELAY);
  }
}
