import { esc } from './dom.mjs';
import { WebPlayer } from '../player/web-player.mjs';
import { mountRatings } from './ratings.mjs';

const icons = {
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  like: '<path d="M7 10v11H3V10h4Zm0 0 5-7c2-1 3 1 2 4l-1 3h6c2 0 2 2 1 5l-2 6H7"/>',
  details: '<path d="m6 9 6 6 6-6"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 6 6m0-6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
const PREVIEW_SECONDS = 12;

function metadata(item) {
  const year = String(item.year || item.releaseDate || '').match(/\b(?:19|20)\d{2}\b/)?.[0];
  const count = Number(item.episodeCount);
  const length = item.kind === 'series' && count > 0 ? `${count} episódios` : item.duration;
  const quality = String(item.name || '').match(/\b(?:4K|8K|UHD|FHD|HD|SD|1080p|2160p|720p)\b/i)?.[0];
  const age = String(item.ageRating || item.certification || '').trim();
  return `${[year, length].filter(Boolean).map(value => `<span>${esc(value)}</span>`).join('<i>•</i>')}
    ${age ? `<span class="hover-preview-age">${esc(age)}</span>` : ''}
    ${quality ? `<span class="hover-preview-quality">${esc(quality.toUpperCase())}</span>` : ''}`;
}

/** A single floating preview; leaving it releases playback and the audio stream. */
export function attachHoverPreview(grid, lookup, { onPreview, onOpen, onPlay, onAutoPlay, onFavorite, isFavorite, onLike, isLiked, onPreviewDetails, getRating, onRate }) {
  if (!onPreview || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)
    return { stop() {}, dispose() {} };
  const engine = new WebPlayer({ preview: true, maxPreviewHeight: 480 });
  let hovered = null;
  let panel = null;
  let video = null;
  let hoverTimer = null;
  let leaveTimer = null;
  let playbackTimer = null;
  let leaving = false;
  let watchdog = null;
  let request = null;
  let generation = 0;

  function stop() {
    generation += 1;
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    clearInterval(playbackTimer);
    playbackTimer = null;
    leaving = false;
    clearTimeout(watchdog);
    request?.abort();
    request = null;
    engine.destroy();
    panel?.remove();
    hovered?.classList.remove('preview-active');
    hovered?.removeAttribute('aria-expanded');
    hovered?.removeAttribute('aria-controls');
    panel = video = hovered = null;
  }

  function leave() {
    leaving = true;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(stop, 150);
  }

  function stay() {
    leaving = false;
    clearTimeout(leaveTimer);
  }

  function updateInfo(element, item) {
    const title = String(item.name || '').replace(/(?:\s*[-|]?\s*(?:\[(?:HD|FHD|4K|UHD|SD|DUBLADO)\]|\((?:HD|FHD|4K|UHD|SD|DUBLADO)\)|\b(?:HD|FHD|4K|UHD|SD|DUBLADO)))+\s*$/gi, '').trim();
    element.querySelector('.hover-preview-name').textContent = title || item.name || 'Sem título';
    element.querySelector('.hover-preview-type').textContent = item.kind === 'series' ? 'Série' : 'Filme';
    const genre = element.querySelector('.hover-preview-genre');
    genre.textContent = item.genre || '';
    genre.hidden = !item.genre;
    element.querySelector('.hover-preview-metadata').innerHTML = metadata(item);
    const image = element.querySelector('.hover-preview-cover');
    const source = item.backdrop || item.image;
    if (source && image.getAttribute('src') !== source) image.src = source;
  }

  function position(element, card) {
    const box = card.getBoundingClientRect();
    const width = Math.min(520, innerWidth - 24);
    element.style.width = `${width}px`;
    const height = element.offsetHeight;
    element.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, box.left + box.width / 2 - width / 2))}px`;
    element.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, box.top + box.height / 2 - height / 2))}px`;
    element.style.transformOrigin = `${Math.max(0, Math.min(width, box.left + box.width / 2 - parseFloat(element.style.left)))}px center`;
  }

  async function start(card) {
    if (hovered !== card || !grid.isConnected || !card.isConnected) return;
    const item = lookup(card);
    if (!item || !['vod', 'series'].includes(item.kind)) return;
    const token = generation;
    request = new AbortController();
    const signal = request.signal;
    const element = document.createElement('section');
    element.className = 'hover-preview';
    element.id = 'catalog-hover-preview';
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', `Prévia de ${item.name}`);
    element.innerHTML = `<div class="hover-preview-visual">
      <img class="hover-preview-cover" alt="" referrerpolicy="no-referrer">
      <video class="hover-preview-video" playsinline preload="metadata" disablepictureinpicture aria-label="Prévia do título"></video>
      <div class="hover-preview-shade"></div><strong class="hover-preview-name"></strong>
      <button class="hover-preview-sound" data-preview-action="sound" title="Desativar som" aria-label="Desativar som">${icon('sound')}</button>
    </div><div class="hover-preview-info">
      <div class="hover-preview-classification"><strong class="hover-preview-type"></strong><span class="hover-preview-genre"></span></div>
      <div class="hover-preview-metadata"></div>
      <div class="hover-preview-actions">
        <button class="hover-preview-play" data-preview-action="play" aria-label="Assistir" title="Assistir">${icon('play')}</button>
        ${onFavorite ? `<button data-preview-action="favorite" title="Minha lista">${icon('plus')}</button>` : ''}
        ${onLike ? `<button data-preview-action="like" aria-label="Gostei" title="Gostei">${icon('like')}</button>` : ''}
        <button class="hover-preview-details" data-preview-action="details" aria-label="Ver detalhes" title="Ver detalhes">${icon('details')}</button>
      </div>
      <span class="hover-preview-status" role="status" aria-live="polite">Preparando prévia…</span>
    </div>`;
    const media = element.querySelector('video');
    media.muted = media.defaultMuted = false;
    media.volume = 0.7;
    updateInfo(element, item);
    const updateButtons = () => {
      const favorite = element.querySelector('[data-preview-action="favorite"]');
      const saved = Boolean(isFavorite?.(item));
      if (favorite) {
        favorite.innerHTML = icon(saved ? 'check' : 'plus');
        favorite.setAttribute('aria-pressed', String(saved));
        favorite.setAttribute('aria-label', saved ? 'Remover da minha lista' : 'Adicionar à minha lista');
        favorite.title = saved ? 'Remover da minha lista' : 'Adicionar à minha lista';
      }
      element.querySelector('[data-preview-action="like"]')?.setAttribute('aria-pressed', String(Boolean(isLiked?.(item))));
    };
    updateButtons();
    mountRatings(element.querySelector('.hover-preview-actions'), item, { getRating, onRate });
    panel = element;
    video = media;
    document.body.append(element);
    position(element, card);
    card.classList.add('preview-active');
    card.setAttribute('aria-expanded', 'true');
    card.setAttribute('aria-controls', element.id);
    element.addEventListener('pointerenter', stay);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', stay);
    element.addEventListener('focusout', event => {
      if (!element.contains(event.relatedTarget) && event.relatedTarget !== card) leave();
    });
    const status = element.querySelector('.hover-preview-status');
    // Bound preparation as well as playback: a stalled IPC/server must not
    // leave a preview engine buffering until the pointer moves away.
    watchdog = setTimeout(() => {
      if (generation !== token) return;
      request?.abort();
      request = null;
      engine.destroy();
      media.classList.remove('ready');
      status.textContent = 'Prévia indisponível';
    }, 12000);
    element.addEventListener('click', async event => {
      const action = event.target.closest('[data-preview-action]')?.dataset.previewAction
        || (event.target.closest('.hover-preview-visual') ? 'details' : '');
      if (!action) return;
      event.stopPropagation();
      try {
        if (action === 'sound') {
          media.muted = !media.muted;
          const button = element.querySelector('[data-preview-action="sound"]');
          button.innerHTML = icon(media.muted ? 'mute' : 'sound');
          button.title = media.muted ? 'Ativar som' : 'Desativar som';
          button.setAttribute('aria-label', button.title);
        } else if (action === 'favorite' || action === 'like') {
          await (action === 'favorite' ? onFavorite : onLike)?.(item);
          if (generation === token) updateButtons();
        } else {
          stop();
          await (action === 'play' ? (onPlay || onOpen) : onOpen)?.(item);
        }
      } catch { if (element.isConnected) status.textContent = 'Não foi possível concluir a ação.'; }
    });
    try {
      const playback = await onPreview(item, { signal });
      if (generation !== token || signal.aborted || hovered !== card || !card.isConnected) return;
      if (!playback?.url) throw new Error('Prévia indisponível');
      if (onPreviewDetails) Promise.resolve().then(() => onPreviewDetails(item)).then(details => {
        if (generation !== token || signal.aborted || !details) return;
        updateInfo(element, { ...item, ...details });
        position(element, card);
      }).catch(() => {});
      media.addEventListener('playing', () => {
        if (generation === token && !signal.aborted) {
          media.classList.add('ready');
          status.textContent = onAutoPlay ? 'Inicia do começo em 12 s · afaste o mouse para cancelar' : '';
        }
      }, { once: true });
      await engine.play(media, playback);
      if (generation !== token || signal.aborted || hovered !== card) return;
      if (media.paused) await media.play();
      if (generation !== token || signal.aborted) return;
      clearTimeout(watchdog);
      let watched = 0;
      let previousTime = media.currentTime;
      let lastAdvanceAt = performance.now();
      let previousRemaining = null;
      playbackTimer = setInterval(() => {
        if (generation !== token || signal.aborted) return;
        if (document.hidden || !grid.isConnected || !card.isConnected
            || document.getElementById('modal-root')?.childElementCount) return stop();
        const delta = media.currentTime - previousTime;
        previousTime = media.currentTime;
        if (media.ended) {
          clearInterval(playbackTimer);
          engine.destroy();
          media.classList.remove('ready');
          status.textContent = 'Prévia concluída';
          return;
        }
        if (performance.now() - lastAdvanceAt > 12000) {
          clearInterval(playbackTimer);
          request?.abort();
          engine.destroy();
          media.classList.remove('ready');
          status.textContent = 'Prévia indisponível';
          return;
        }
        // Count video actually shown, not buffering, pauses or timestamp jumps.
        if (leaving || media.paused || media.seeking || media.readyState < 2) return;
        if (delta > 0 && delta <= 1.25) {
          watched += delta;
          lastAdvanceAt = performance.now();
        }
        const remaining = Math.max(0, Math.ceil(PREVIEW_SECONDS - watched));
        if (onAutoPlay && previousRemaining !== remaining) {
          status.textContent = `Inicia do começo em ${remaining} s · afaste o mouse para cancelar`;
          previousRemaining = remaining;
        }
        if (watched < PREVIEW_SECONDS) return;
        clearInterval(playbackTimer);
        if (onAutoPlay) {
          // Release the preview's connection before opening the full player.
          stop();
          Promise.resolve().then(() => onAutoPlay(item)).catch(() => {});
        } else {
          engine.destroy();
          media.classList.remove('ready');
          status.textContent = 'Prévia concluída';
        }
      }, 250);
    } catch {
      if (generation !== token || signal.aborted) return;
      clearTimeout(watchdog);
      engine.destroy();
      media.classList.remove('ready');
      status.textContent = 'Prévia indisponível';
    }
  }

  function pointerOver(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const card = event.target.closest('.item-card-poster');
    if (!card || !grid.contains(card)) return;
    if (card === hovered) { stay(); return; }
    stop();
    hovered = card;
    hoverTimer = setTimeout(() => start(card), 800);
  }
  function pointerOut(event) {
    if (!hovered || hovered.contains(event.relatedTarget) || panel?.contains(event.relatedTarget)) return;
    if (hovered.contains(event.target)) leave();
  }
  function visibilityChange() { if (document.hidden) stop(); }
  function scroll(event) { if (!panel?.contains(event.target)) stop(); }
  function keydown(event) { if (event.key === 'Escape' && panel) { event.stopPropagation(); stop(); } }
  grid.addEventListener('pointerover', pointerOver);
  grid.addEventListener('pointerout', pointerOut);
  document.addEventListener('visibilitychange', visibilityChange);
  window.addEventListener('blur', stop);
  window.addEventListener('resize', stop);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('keydown', keydown, true);
  return {
    stop,
    dispose() {
      stop();
      grid.removeEventListener('pointerover', pointerOver);
      grid.removeEventListener('pointerout', pointerOut);
      document.removeEventListener('visibilitychange', visibilityChange);
      window.removeEventListener('blur', stop);
      window.removeEventListener('resize', stop);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('keydown', keydown, true);
    }
  };
}
