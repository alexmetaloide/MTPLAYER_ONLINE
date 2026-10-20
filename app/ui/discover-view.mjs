import { root, esc } from './dom.mjs';
import { WebPlayer } from '../player/web-player.mjs';
import { shuffleFeed } from '../core/shuffle.mjs';
import { feedCategoryFilter } from '../core/feed-categories.mjs';

const CLIP_SECONDS = 25;

export function renderDiscoverView(items, { onPreview, onWatch, onDetails, onFavorite, isFavorite, onShare, categories = [], onCategoryChange, mode = 'discover' }) {
  const recent = mode === 'recent';
  let queue = recent ? [...items] : shuffleFeed(items);
  const view = document.createElement('section');
  view.className = 'discover-view';
  view.innerHTML = `<header class="discover-header">
    <button class="discover-back" data-view="home" aria-label="Voltar ao início">←</button>
    <div><p class="eyebrow">${recent ? 'NOVIDADES DO SEU CATÁLOGO' : 'UM NOVO JEITO DE ESCOLHER'}</p><h1>${recent ? 'Adicionados recentemente' : 'Descubra'} <span>${recent ? '◷' : '✦'}</span></h1></div>
    <label class="discover-category-filter"><span>Categoria</span><select aria-label="Filtrar por categoria">
      <option value="all">Todas as categorias</option>
      ${['vod', 'series'].map(kind => {
        const options = categories.filter(category => category.kind === kind);
        return options.length ? `<optgroup label="${kind === 'vod' ? 'Filmes' : 'Séries'}">${options.map(category => `<option value="${esc(category.value)}">${esc(category.name)}</option>`).join('')}</optgroup>` : '';
      }).join('')}
    </select></label>
  </header>
  <div class="discover-layout">
    <div class="discover-feed" aria-label="Feed de filmes e séries">
      <div class="discover-poster-frame">
        <img class="discover-cover" alt="" referrerpolicy="no-referrer">
        <video class="discover-video" playsinline preload="metadata" disablepictureinpicture aria-label="Prévia do título"></video>
        <div class="discover-gradient"></div>
        <div class="discover-topline"><span class="discover-kicker">${recent ? '◷ ADICIONADOS RECENTEMENTE' : '✦ DESCUBRA'}</span></div>
        <div class="discover-progress"><i></i></div>
        <div class="discover-caption"><div class="discover-type"></div><h2 class="discover-name"></h2>
          <div class="discover-tags"></div><p class="discover-plot"></p>
          <div class="discover-actions-main"><button class="discover-watch" data-discover-action="watch">▶ Assistir agora</button>
          <button class="discover-details" data-discover-action="details">ⓘ Detalhes</button></div>
          <span class="discover-hint" role="status" aria-live="polite"></span>
        </div>
        <div class="discover-buttons">
          <button data-discover-action="favorite" title="Adicionar aos favoritos" aria-label="Favoritar">☆<small>Minha lista</small></button>
          <button data-discover-action="sound" title="Desativar som" aria-label="Desativar som">♫<small>Com som</small></button>
          <button data-discover-action="pause" title="Pausar prévia" aria-label="Pausar prévia">Ⅱ<small>Pausar</small></button>
          <button data-discover-action="share" title="Compartilhar recomendação" aria-label="Compartilhar">↗<small>Indicar</small></button>
        </div>
        <div class="discover-filter-empty" hidden role="status" aria-live="polite">
          <div><span aria-hidden="true">◷</span><h2></h2><p></p>
            <button data-discover-reset>Ver todas as categorias</button><button data-view="home">Voltar ao início</button></div>
        </div>
      </div>
    </div>
    <aside class="discover-navigation" aria-label="Navegação entre as prévias">
      <button data-discover-action="previous" title="Anterior">↑</button>
      <span>Arraste para descobrir<br>ou use ↑ e ↓</span>
      <button data-discover-action="next" title="Próximo">↓</button>
    </aside>
  </div>`;
  root.replaceChildren(view);
  const one = selector => view.querySelector(selector);
  const video = one('.discover-video');
  const cover = one('.discover-cover');
  const hint = one('.discover-hint');
  const progress = one('.discover-progress i');
  const categorySelect = one('.discover-category-filter select');
  const empty = one('.discover-filter-empty');
  const engine = new WebPlayer({ preview: true, maxPreviewHeight: 720, previewSeconds: CLIP_SECONDS });
  let index = 0;
  let generation = 0;
  let destroyed = false;
  let muted = false;
  video.defaultMuted = false;
  video.muted = false;
  video.volume = 0.7;
  let clipStart = null;
  let timer = null;
  let watchdog = null;
  let request = null;
  let gestureStart = null;
  let wheelTime = 0;

  const current = () => queue[index];
  const isCurrent = token => !destroyed && token === generation && view.isConnected;
  function clearTimers() {
    clearInterval(timer);
    clearTimeout(watchdog);
    timer = null;
    watchdog = null;
  }

  function stopPreview() {
    generation += 1;
    clearTimers();
    request?.abort();
    request = null;
    engine.destroy();
    video.classList.remove('discover-video-ready');
    clipStart = null;
    progress.style.width = '0%';
  }

  async function loadPreview() {
    stopPreview();
    const token = generation;
    request = new AbortController();
    const item = current();
    if (!item || document.hidden) return;
    video.muted = muted;
    hint.textContent = 'Preparando prévia…';
    watchdog = setTimeout(() => {
      if (!isCurrent(token) || clipStart !== null) return;
      generation += 1;
      request?.abort();
      engine.destroy();
      video.classList.remove('discover-video-ready');
      clearInterval(timer);
      hint.textContent = 'Prévia indisponível. Veja a capa e os detalhes.';
    }, 12000);
    try {
      const playback = await onPreview(item, { signal: request.signal });
      if (!isCurrent(token)) return;
      if (!playback?.url) throw new Error('Sem stream de prévia');
      await engine.play(video, playback);
      if (!isCurrent(token)) return;
      if (video.paused) await video.play();
      if (!isCurrent(token)) return;
      video.classList.add('discover-video-ready');
      hint.textContent = 'Trecho de até 25 segundos • Deslize para o próximo';
      timer = setInterval(() => {
        if (!isCurrent(token) || video.paused || video.readyState < 2) return;
        if (clipStart === null) {
          clipStart = video.currentTime;
          clearTimeout(watchdog);
        }
        const elapsed = Math.max(0, video.currentTime - clipStart);
        progress.style.width = `${Math.min(100, elapsed / CLIP_SECONDS * 100)}%`;
        if (elapsed >= CLIP_SECONDS || video.ended) advance(1);
      }, 250);
      one('[data-discover-action="pause"]').innerHTML = 'Ⅱ<small>Pausar</small>';
    } catch {
      if (!isCurrent(token)) return;
      engine.destroy();
      hint.textContent = 'Prévia indisponível. Você ainda pode abrir o título.';
      clearTimeout(watchdog);
    }
  }

  function showCurrent() {
    const item = current();
    view.classList.toggle('discover-is-empty', !item);
    empty.hidden = Boolean(item);
    if (!item) {
      stopPreview();
      const filtered = categorySelect.value !== 'all';
      empty.querySelector('h2').textContent = filtered ? 'Nenhuma prévia nesta categoria'
        : recent ? 'Nenhuma adição recente encontrada' : 'Nenhuma prévia disponível';
      empty.querySelector('p').textContent = filtered
        ? (recent ? 'Não há filmes ou séries elegíveis adicionados nos últimos 60 dias nesta categoria.' : 'Não há filmes ou séries elegíveis para prévia nesta categoria.')
        : recent ? 'Este modo mostra filmes e séries incluídos nos últimos 60 dias. Listas sem datas detectam novas adições nas próximas atualizações.'
          : 'Adicione uma lista com filmes e séries ou atualize seu catálogo.';
      one('[data-discover-reset]').hidden = !filtered;
      return;
    }
    one('.discover-type').textContent = item.kind === 'series' ? 'SÉRIE' : 'FILME';
    one('.discover-name').textContent = item.name || 'Sem título';
    const addedLabel = recent && Number.isFinite(item.recentAddedAt)
      ? `Adicionado em ${new Date(item.recentAddedAt).toLocaleDateString('pt-BR')}` : '';
    one('.discover-tags').textContent = [addedLabel, item.year, item.genre, item.rating ? `★ ${item.rating}` : ''].filter(Boolean).join('  •  ');
    one('.discover-plot').textContent = item.plot || 'Encontre uma nova história para assistir no seu catálogo.';
    const image = item.backdrop || item.image || '';
    cover.style.display = image ? '' : 'none';
    if (image) cover.src = image;
    else cover.removeAttribute('src');
    const favorite = Boolean(isFavorite(item));
    one('[data-discover-action="favorite"]').innerHTML = `${favorite ? '★' : '☆'}<small>${favorite ? 'Na lista' : 'Minha lista'}</small>`;
    one('[data-discover-action="sound"]').innerHTML = `${muted ? '♩' : '♫'}<small>${muted ? 'Sem som' : 'Com som'}</small>`;
    one('[data-discover-action="sound"]').title = muted ? 'Ativar som' : 'Desativar som';
    one('[data-discover-action="sound"]').setAttribute('aria-label', muted ? 'Ativar som' : 'Desativar som');
    loadPreview();
  }

  function changeCategory() {
    if (destroyed) return;
    stopPreview();
    index = 0;
    try {
      const matchesCategory = feedCategoryFilter(categorySelect.value);
      const selected = onCategoryChange ? onCategoryChange(categorySelect.value)
        : items.filter(matchesCategory);
      queue = recent ? [...(Array.isArray(selected) ? selected : [])]
        : shuffleFeed(Array.isArray(selected) ? selected : []);
    } catch { queue = []; }
    showCurrent();
  }
  categorySelect.addEventListener('change', changeCategory);
  one('[data-discover-reset]').addEventListener('click', () => {
    categorySelect.value = 'all';
    changeCategory();
  });

  function advance(direction) {
    if (!queue.length || destroyed) return;
    if (queue.length > 1 && ((direction > 0 && index === queue.length - 1)
      || (direction < 0 && index === 0))) {
      const previous = current();
      const key = `${previous.kind}:${previous.id}`;
      if (!recent) queue = shuffleFeed(queue, direction > 0 ? { avoidFirstKey: key } : { avoidLastKey: key });
      index = direction > 0 ? 0 : queue.length - 1;
    } else index = (index + direction + queue.length) % queue.length;
    showCurrent();
  }

  async function action(name) {
    const item = current();
    if (!item) return;
    if (name === 'next') return advance(1);
    if (name === 'previous') return advance(-1);
    if (name === 'favorite') {
      onFavorite(item);
      one('[data-discover-action="favorite"]').innerHTML = isFavorite(item) ? '★<small>Na lista</small>' : '☆<small>Minha lista</small>';
    }
    if (name === 'sound') {
      muted = !muted;
      video.muted = muted;
      one('[data-discover-action="sound"]').innerHTML = `${muted ? '♩' : '♫'}<small>${muted ? 'Sem som' : 'Com som'}</small>`;
      one('[data-discover-action="sound"]').title = muted ? 'Ativar som' : 'Desativar som';
      one('[data-discover-action="sound"]').setAttribute('aria-label', muted ? 'Ativar som' : 'Desativar som');
    }
    if (name === 'pause') {
      if (!video.classList.contains('discover-video-ready')) return;
      if (video.paused) {
        try { await video.play(); } catch {}
      } else video.pause();
      one('[data-discover-action="pause"]').innerHTML = video.paused ? '▶<small>Retomar</small>' : 'Ⅱ<small>Pausar</small>';
    }
    if (name === 'share') return onShare(item);
    if (name === 'watch' || name === 'details') {
      video.pause();
      return (name === 'watch' ? onWatch : onDetails)(item);
    }
  }

  view.addEventListener('click', event => {
    const button = event.target.closest('[data-discover-action]');
    if (button) Promise.resolve(action(button.dataset.discoverAction)).catch(() => {});
  });

  const handleKeys = event => {
    if (destroyed || !view.isConnected || document.getElementById('modal-root')?.childElementCount || event.target.closest('input, textarea, select')) return;
    if (['ArrowDown', 'PageDown'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); advance(1); }
    if (['ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); advance(-1); }
  };
  window.addEventListener('keydown', handleKeys, true);

  view.addEventListener('wheel', event => {
    if (event.target.closest('.discover-category-filter')) return;
    if (Math.abs(event.deltaY) < 7) return;
    event.preventDefault();
    if (Date.now() - wheelTime < 520) return;
    wheelTime = Date.now();
    advance(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  view.addEventListener('touchstart', event => {
    if (event.target.closest('.discover-category-filter')) { gestureStart = null; return; }
    gestureStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  view.addEventListener('touchend', event => {
    if (!gestureStart) return;
    const dx = event.changedTouches[0].clientX - gestureStart.x;
    const dy = event.changedTouches[0].clientY - gestureStart.y;
    gestureStart = null;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2) advance(dy < 0 ? 1 : -1);
  }, { passive: true });
  const handleVisibility = () => {
    if (document.hidden) stopPreview();
    else if (!destroyed && current()) loadPreview();
  };
  document.addEventListener('visibilitychange', handleVisibility);
  const handleVideoEnded = () => advance(1);
  video.addEventListener('ended', handleVideoEnded);
  showCurrent();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPreview();
      window.removeEventListener('keydown', handleKeys, true);
      document.removeEventListener('visibilitychange', handleVisibility);
      video.removeEventListener('ended', handleVideoEnded);
    }
  };
}
