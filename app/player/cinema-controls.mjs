import { PLAYBACK_RATES } from './player-adapter.mjs';

// Original MTPLAYER controls. No branding, external assets, or dependencies.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  play: ['M8 5l12 7-12 7z'], pause: ['M8 5v14M16 5v14'],
  back10: ['M5 7V2m0 5h5', 'M5 7a9 9 0 1 1-2 9'],
  forward10: ['M19 7V2m0 5h-5', 'M19 7a9 9 0 1 0 2 9'],
  volume: ['M11 4L5 9H2v6h3l6 5z', 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'],
  mute: ['M11 4L5 9H2v6h3l6 5z', 'M16 9l6 6m0-6-6 6'],
  next: ['M5 5l11 7-11 7zM19 5v14'], previous: ['M19 5L8 12l11 7zM5 5v14'],
  episodes: ['M4 3h16M2 7h20v14H2z', 'M10 11l6 3-6 3z'],
  tracks: ['M3 4h18v14H9l-6 4z', 'M7 9h10M7 13h7'],
  speed: ['M3 18a10 10 0 1 1 18 0', 'M12 14l5-7'],
  fullscreen: ['M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6'],
  exit: ['M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6'],
  channels: ['M3 5h18v14H3z', 'M8 2l4 3 4-3M8 9h8M8 14h8']
};

export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const rest = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Owns only its overlay/listeners, never the player session or top-bar callbacks. */
export class CinemaControls {
  constructor({ root, video, player, item, getEpisodes = () => [], onEpisode = () => {}, onChannels = () => {}, onPrevious = () => {}, onNext = () => {}, onError = () => {} }) {
    if (!root || !video || !player) throw new TypeError('root, video e player são obrigatórios.');
    Object.assign(this, { root, video, player, item, getEpisodes, onEpisode, onChannels, onPrevious, onNext, onError });
    this.doc = root.ownerDocument;
    this.timers = this.doc.defaultView || globalThis;
    this.hideTimer = null;
    this.keyboardFocus = false;
    this.pointerMode = false;
    this.loading = video.readyState < 3 && !video.paused;
    this.shell = root.querySelector('.video-shell');
    if (!this.shell) throw new TypeError('O player precisa de .video-shell.');
    this.listeners = [];
    this.menuListeners = [];
    this.menuVersion = 0;
    this.destroyed = false;
    this.remaining = true;
    this.session = 0;
    this.originalControls = video.controls;
    this.top = root.querySelector('.player-top');
    this.topParent = this.top?.parentNode;
    this.topNext = this.top?.nextSibling;
    if (this.top) this.shell.append(this.top);
    root.classList.add('cinema-player');
    video.controls = false;
    this.nodes = {};
    this.overlay = this.el('div', 'controls', 'cinema-controls');
    this.shell.append(this.overlay);
    this.timeline = this.el('div', 'timeline', 'cinema-timeline');
    this.rail = this.el('div', 'rail', 'cinema-rail');
    this.buffered = this.el('i', 'buffered', 'cinema-buffered');
    this.played = this.el('i', 'played', 'cinema-played');
    this.seek = this.el('input', 'seek', 'cinema-seek');
    this.seek.type = 'range'; this.seek.min = '0'; this.seek.step = '0.1';
    this.seek.setAttribute('aria-label', 'Posição da reprodução');
    this.time = this.button('time', 'Alternar tempo decorrido / restante', null, () => { this.remaining = !this.remaining; this.refresh(); });
    this.hover = this.el('output', 'hover', 'cinema-hover'); this.hover.hidden = true;
    this.hover.setAttribute('aria-hidden', 'true');
    this.rail.append(this.buffered, this.played, this.seek, this.hover);
    this.listen(this.rail, 'pointermove', event => {
      if (this.seek.disabled || this.timeline.hidden) { this.hover.hidden = true; return; }
      const bounds = this.rail.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1)));
      this.hover.textContent = formatTime(fraction * Number(this.seek.max));
      this.hover.style.left = `${fraction * 100}%`; this.hover.hidden = false;
    });
    this.listen(this.rail, 'pointerleave', () => { this.hover.hidden = true; });
    this.timeline.append(this.rail, this.time);
    this.row = this.el('div', 'row', 'cinema-row');
    this.left = this.el('div', 'left', 'cinema-group');
    this.right = this.el('div', 'right', 'cinema-group');
    this.title = this.el('div', 'title', 'cinema-title');
    this.play = this.button('play', 'Reproduzir (Espaço / K)', 'play', () => this.run(() => this.player.togglePlayback(this.video)));
    this.rewind = this.button('rewind', 'Voltar 10 segundos (J / ←)', 'back10', () => this.seekBy(-10));
    this.forward = this.button('forward', 'Avançar 10 segundos (L / →)', 'forward10', () => this.seekBy(10));
    this.mute = this.button('mute', 'Silenciar (M)', 'volume', () => this.toggleMute());
    this.volume = this.el('input', 'volume', 'cinema-volume');
    Object.assign(this.volume, { type: 'range', min: '0', max: '1', step: '0.05' });
    this.volume.setAttribute('aria-label', 'Volume');
    this.listen(this.volume, 'input', () => this.setVolume(Number(this.volume.value)));
    this.listen(this.seek, 'input', () => this.seekTo(Number(this.seek.value)));
    this.left.append(this.play, this.rewind, this.forward, this.mute, this.volume);
    this.tracksButton = this.button('tracks', 'Áudio e legendas', 'tracks', () => this.openMenu('tracks'));
    this.tracksButton.setAttribute('aria-haspopup', 'dialog');
    this.tracksButton.setAttribute('aria-expanded', 'false');
    this.speedButton = this.button('speed', 'Velocidade 1×', 'speed', () => this.openMenu('speed'));
    this.speedButton.setAttribute('aria-haspopup', 'dialog');
    this.speedButton.setAttribute('aria-expanded', 'false');
    this.next = this.button('next', 'Próximo episódio', 'next', () => this.run(() => { if (this.item?.kind === 'live') return this.onNext(); const episode = this.nextEpisode(); if (episode) return this.onEpisode(episode); }));
    this.previous = this.button('previous', 'Canal anterior', 'previous', () => this.run(this.onPrevious));
    this.channels = this.button('channels', 'Lista de canais', 'channels', () => this.run(this.onChannels));
    this.live = this.el('span', 'live', 'cinema-live'); this.live.textContent = 'AO VIVO';
    this.left.append(this.live);
    this.episodesButton = this.button('episodes', 'Episódios', 'episodes', () => this.openMenu('episodes'));
    this.episodesButton.setAttribute('aria-haspopup', 'dialog');
    this.episodesButton.setAttribute('aria-expanded', 'false');
    this.fullscreen = this.button('fullscreen', 'Tela cheia (F)', 'fullscreen', () => this.toggleFullscreen());
    this.right.append(this.previous, this.channels, this.next, this.episodesButton, this.tracksButton, this.speedButton, this.fullscreen);
    this.panel = this.el('div', 'panel', 'cinema-panel');
    this.nativeStatus = this.el('p', 'native-status', 'cinema-native-status');
    this.nativeStatus.textContent = 'Reprodução nativa · use os controles do player nativo';
    this.panel.hidden = true; this.panel.setAttribute('role', 'dialog');
    this.row.append(this.left, this.title, this.right);
    this.overlay.append(this.panel, this.nativeStatus, this.timeline, this.row);
    for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'play', 'pause', 'ended', 'volumechange', 'ratechange', 'emptied']) this.listen(video, event, () => this.refresh());
    this.listen(this.doc, 'fullscreenchange', () => { this.refresh(); this.show(); });
    for (const event of ['waiting', 'stalled', 'seeking', 'loadstart']) this.listen(video, event, () => { this.loading = true; this.show(); });
    for (const event of ['playing', 'canplay', 'seeked', 'error']) this.listen(video, event, () => { this.loading = false; this.refresh(); this.show(); });
    this.listen(this.shell, 'pointermove', () => this.show());
    this.listen(this.shell, 'pointerdown', event => {
      this.pointerMode = true; this.keyboardFocus = false;
      if (this.menu && !this.panel.contains(event.target) && !this.menuTrigger?.contains(event.target)) this.closeMenu();
      this.show();
    }, true);
    this.listen(this.shell, 'pointerup', () => {
      // Pointer focus must not keep controls pinned after a mouse click. Never
      // blur keyboard focus, sliders being dragged, or an open menu choice.
      queueMicrotask(() => {
        if (this.destroyed) return;
        const active = this.doc.activeElement;
        if (!this.keyboardFocus && !this.menu && this.ownsFocus(active)) active.blur?.();
        this.show();
      });
    });
    this.listen(this.shell, 'focusin', () => { if (!this.pointerMode) this.keyboardFocus = true; this.show(); });
    this.listen(this.shell, 'focusout', () => { queueMicrotask(() => { if (!this.destroyed) this.syncVisibility(); }); });
    this.refresh();
  }

  el(tag, name, className = '') {
    const node = this.doc.createElement(tag);
    if (name) { node.setAttribute('data-cinema', name); this.nodes[name] = node; }
    if (className) node.className = className;
    return node;
  }

  listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this.listeners.push(() => target.removeEventListener(type, callback, options));
  }

  icon(button, name) {
    if (button.dataset.icon === name) return;
    button.dataset.icon = name;
    const svg = this.doc.createElementNS(SVG_NS, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
    for (const d of ICONS[name] || []) { const path = this.doc.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); if (name === 'play') path.setAttribute('fill', 'currentColor'); svg.append(path); }
    if (name === 'back10' || name === 'forward10') {
      const text = this.doc.createElementNS(SVG_NS, 'text');
      for (const [k, v] of Object.entries({ x: '12', y: '16', 'text-anchor': 'middle', 'font-size': '8', stroke: 'none', fill: 'currentColor', 'font-weight': '700' })) text.setAttribute(k, v);
      text.textContent = '10'; svg.append(text);
    }
    button.replaceChildren(svg);
  }

  label(button, text) { button.setAttribute('aria-label', text); button.setAttribute('data-tooltip', text); button.title = text; }

  button(name, label, icon, callback) {
    const button = this.el('button', name, 'cinema-button'); button.type = 'button';
    this.label(button, label);
    if (icon) this.icon(button, icon);
    if (callback) this.listen(button, 'click', callback);
    return button;
  }

  async run(action) {
    if (this.destroyed) return;
    const session = this.session;
    try { await action(); if (!this.destroyed && session === this.session) this.refresh(); }
    catch (error) { if (!this.destroyed && session === this.session) this.onError(error); }
  }

  clearMenu() {
    for (const remove of this.menuListeners.splice(0)) remove();
    this.panel.replaceChildren();
  }

  closeMenu(restoreFocus = false) {
    const trigger = this.menuTrigger;
    this.menuVersion += 1;
    this.clearMenu(); this.panel.hidden = true; this.menu = null;
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !this.destroyed) trigger?.focus();
    this.menuTrigger = null;
    if (!this.destroyed) this.syncVisibility();
  }

  heading(text) {
    const node = this.el('h3'); node.textContent = text; this.panel.append(node);
  }

  message(text) { const node = this.el('p'); node.textContent = text; this.panel.append(node); }

  option(name, label, selected, callback) {
    const node = this.el('button', name, 'cinema-option');
    node.type = 'button'; node.textContent = String(label);
    node.setAttribute('role', 'radio'); node.setAttribute('aria-checked', String(Boolean(selected)));
    const version = this.menuVersion;
    const choose = () => this.run(async () => { await callback(); if (!this.destroyed && version === this.menuVersion) this.closeMenu(this.keyboardFocus); });
    node.addEventListener('click', choose);
    this.menuListeners.push(() => node.removeEventListener('click', choose));
    this.panel.append(node); return node;
  }

  async openMenu(type) {
    if (this.destroyed || (type === 'speed' && (this.speedButton.disabled || this.speedButton.hidden)) || (type === 'tracks' && this.tracksButton.disabled)) return;
    if (this.menu === type) { this.closeMenu(); return; }
    this.closeMenu(); this.menu = type; this.menuTrigger = type === 'episodes' ? this.episodesButton : type === 'speed' ? this.speedButton : this.tracksButton;
    this.menuTrigger.setAttribute('aria-expanded', 'true');
    this.panel.setAttribute('aria-label', type === 'episodes' ? 'Episódios' : type === 'speed' ? 'Velocidade de reprodução' : 'Áudio e legendas');
    this.panel.hidden = false; this.show();
    const version = this.menuVersion;
    if (type === 'episodes') {
      this.heading('Episódios');
      for (const episode of this.episodes()) this.option(`episode-${episode.id}`, episode.name || episode.title || `Episódio ${episode.episode || episode.id}`, String(episode.id) === String(this.item?.id), () => this.onEpisode(episode));
      if (this.keyboardFocus) this.panel.querySelector('button')?.focus();
      return;
    }
    if (type === 'speed') {
      this.heading('Velocidade');
      for (const rate of PLAYBACK_RATES) this.option(`rate-${rate}`, `${rate}×`, Math.abs(this.video.playbackRate - rate) < 0.01, () => this.player.setPlaybackRate(this.video, rate));
      if (this.keyboardFocus) this.panel.querySelector('button')?.focus();
      return;
    }
    this.message('Carregando faixas…');
    try {
      const tracks = await this.player.tracks(this.video);
      if (this.destroyed || version !== this.menuVersion) return;
      this.clearMenu();
      this.heading('Áudio');
      const audio = Array.isArray(tracks?.audio) ? tracks.audio : [];
      const subtitles = Array.isArray(tracks?.subtitles) ? tracks.subtitles : [];
      if (!audio.length) this.message('Áudio padrão da transmissão');
      for (const track of audio) this.option(`audio-${track.id}`, track.label || track.language || 'Áudio', track.selected, () => this.player.selectTrack('audio', track.id, this.video));
      this.heading('Legendas');
      if (!subtitles.length) this.message('Nenhuma legenda disponível');
      else {
        this.option('subtitle-off', 'Desativadas', !subtitles.some(track => track.selected), () => this.player.selectTrack('subtitle', -1, this.video));
        for (const track of subtitles) this.option(`subtitle-${track.id}`, track.label || track.language || 'Legenda', track.selected, () => this.player.selectTrack('subtitle', track.id, this.video));
      }
      if (this.keyboardFocus) this.panel.querySelector('button')?.focus();
    } catch (error) {
      if (this.destroyed || version !== this.menuVersion) return;
      this.clearMenu(); this.message('Não foi possível carregar as faixas.'); this.onError(error);
    }
  }

  episodes() {
    if (this.item?.kind !== 'series') return [];
    const episodes = this.getEpisodes();
    return Array.isArray(episodes) ? episodes : [];
  }

  nextEpisode() {
    const episodes = this.episodes();
    const index = episodes.findIndex(episode => String(episode.id) === String(this.item?.id));
    return index < 0 ? null : episodes[index + 1] || null;
  }

  seekTo(seconds) {
    if (this.destroyed || this.item?.kind === 'live' || this.seek.disabled) return;
    const position = Math.max(0, Math.min(Number(this.seek.max), Number(seconds) || 0));
    this.run(() => this.player.seek(this.video, position));
  }

  seekBy(seconds) { this.seekTo((Number(this.video.currentTime) || 0) + seconds); }

  toggleMute() {
    if (this.destroyed || this.player.mode === 'native') return;
    this.video.muted = !this.video.muted; this.refresh(); this.show();
  }

  setVolume(value) {
    if (this.destroyed || this.player.mode === 'native') return;
    this.video.volume = Math.max(0, Math.min(1, value));
    this.video.muted = this.video.volume === 0;
    this.refresh(); this.show();
  }

  toggleFullscreen() {
    if (this.destroyed || this.fullscreen.disabled) return;
    this.run(async () => {
      if (this.doc.fullscreenElement === this.shell) await this.doc.exitFullscreen();
      else {
        await this.shell.requestFullscreen();
        // A request may settle after this instance has been disposed.
        if (this.destroyed && this.doc.fullscreenElement === this.shell) await this.doc.exitFullscreen();
      }
    });
  }

  /** Parent calls this before legacy shortcuts; no independent key listener. */
  handleKey(event) {
    if (this.destroyed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;
    const target = event.target;
    if (target?.isContentEditable || target?.closest?.('input, select, textarea, [contenteditable="true"], [role="slider"]')) return false;
    const modal = this.doc.querySelector('#modal-root');
    if (modal && [...modal.children].some(child => !child.hidden && !child.classList.contains('hidden'))) return false;
    const key = String(event.key).toLowerCase();
    if (key === 'tab') { this.pointerMode = false; this.keyboardFocus = true; this.show(); return false; }
    if (key === 'escape' && this.menu) { event.preventDefault(); event.stopImmediatePropagation(); this.closeMenu(true); return true; }
    if (key === 'escape' && this.doc.fullscreenElement === this.shell) { event.preventDefault(); event.stopImmediatePropagation(); this.toggleFullscreen(); return true; }
    if (this.menu) {
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end'].includes(key)) {
        const choices = [...this.panel.querySelectorAll('button')].filter(node => !node.disabled && !node.hidden);
        if (!choices.length) return false;
        const current = choices.indexOf(this.doc.activeElement);
        const backwards = key === 'arrowup' || key === 'arrowleft';
        const next = key === 'home' ? 0 : key === 'end' ? choices.length - 1 : current < 0 ? (backwards ? choices.length - 1 : 0) : (current + (backwards ? -1 : 1) + choices.length) % choices.length;
        event.preventDefault(); event.stopImmediatePropagation();
        this.keyboardFocus = true; choices[next].focus(); this.show(); return true;
      }
      return false; // Native Tab, Enter and Space remain available to the panel.
    }
    if (target?.closest?.('button') && [' ', 'enter', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) return false;
    let action;
    if ((key === ' ' || key === 'k') && !this.play.disabled) action = () => { if (!event.repeat) this.run(() => this.player.togglePlayback(this.video)); };
    else if (['arrowleft', 'j', 'arrowright', 'l'].includes(key) && this.item?.kind !== 'live' && !this.seek.disabled) action = () => this.seekBy(key === 'arrowleft' || key === 'j' ? -10 : 10);
    else if (key === 'f' && !this.fullscreen.disabled) action = () => { if (!event.repeat) this.toggleFullscreen(); };
    else if (key === 'm' && !this.mute.disabled) action = () => { if (!event.repeat) this.toggleMute(); };
    else if (['arrowup', 'arrowdown'].includes(key) && !this.volume.disabled) action = () => this.setVolume(this.video.volume + (key === 'arrowup' ? 0.05 : -0.05));
    else return false;
    event.preventDefault(); event.stopImmediatePropagation(); this.show(); action(); return true;
  }

  /** Updates metadata without touching the playback element or fullscreen. */
  setItem(item) {
    if (this.destroyed) return;
    this.session += 1; this.item = item; this.closeMenu(); this.refresh(); this.show();
  }

  refresh() {
    if (this.destroyed) return;
    const duration = Number.isFinite(this.video.duration) ? Math.max(0, this.video.duration) : 0;
    const position = Math.min(duration, Math.max(0, Number(this.video.currentTime) || 0));
    this.title.textContent = String(this.item?.name || this.item?.title || 'Reprodução');
    this.seek.max = String(duration); this.seek.value = String(position); this.seek.disabled = !duration;
    this.seek.setAttribute('aria-valuetext', `${formatTime(position)} de ${formatTime(duration)}`);
    this.time.textContent = this.remaining ? `−${formatTime(duration - position)}` : `${formatTime(position)} / ${formatTime(duration)}`;
    this.played.style.width = `${duration ? position / duration * 100 : 0}%`;
    let buffered = 0;
    try { for (let i = 0; i < this.video.buffered.length; i++) if (this.video.buffered.start(i) <= position + 0.1) buffered = Math.max(buffered, this.video.buffered.end(i)); } catch { /* A media range may disappear while changing streams. */ }
    this.buffered.style.width = `${duration ? Math.min(duration, buffered) / duration * 100 : 0}%`;
    this.icon(this.play, this.video.paused ? 'play' : 'pause');
    this.label(this.play, this.video.paused ? 'Reproduzir (Espaço / K)' : 'Pausar (Espaço / K)');
    this.volume.value = String(this.video.muted ? 0 : this.video.volume);
    this.volume.setAttribute('aria-valuetext', `${Math.round(Number(this.volume.value) * 100)}%`);
    this.icon(this.mute, this.video.muted || !this.video.volume ? 'mute' : 'volume');
    this.label(this.mute, this.video.muted ? 'Ativar som (M)' : 'Silenciar (M)');
    this.mute.setAttribute('aria-pressed', String(this.video.muted));
    this.speedButton.hidden = !['vod', 'series'].includes(this.item?.kind);
    this.speedButton.disabled = !this.player.supportsPlaybackRate?.(this.video);
    this.label(this.speedButton, this.speedButton.disabled ? 'Velocidade indisponível neste player' : `Velocidade ${this.video.playbackRate}×`);
    this.episodesButton.hidden = this.item?.kind !== 'series' || !this.episodes().length;
    const live = this.item?.kind === 'live';
    this.timeline.hidden = live; this.rewind.hidden = live; this.forward.hidden = live;
    this.previous.hidden = !live; this.channels.hidden = !live; this.live.hidden = !live;
    this.next.hidden = !live && !this.nextEpisode();
    this.label(this.next, live ? 'Próximo canal' : 'Próximo episódio');
    const fullscreen = this.doc.fullscreenElement === this.shell;
    this.fullscreen.disabled = !this.shell.requestFullscreen || !this.doc.exitFullscreen;
    const native = this.player.mode === 'native';
    this.nativeStatus.hidden = !native;
    for (const node of [this.play, this.rewind, this.forward, this.mute, this.volume]) node.disabled = native;
    this.rewind.disabled ||= this.seek.disabled; this.forward.disabled ||= this.seek.disabled;
    this.tracksButton.disabled = native && !(globalThis.desktopAPI?.nativePlayer?.tracks && globalThis.desktopAPI?.nativePlayer?.selectTrack);
    if (native) {
      this.timeline.hidden = true; this.seek.disabled = true; this.speedButton.disabled = true; this.fullscreen.disabled = true;
      this.label(this.play, 'Reprodução controlada pelo player nativo');
      this.label(this.mute, 'Volume controlado pelo player nativo');
      this.label(this.speedButton, 'Velocidade indisponível no player nativo');
    }
    this.label(this.tracksButton, this.tracksButton.disabled ? 'Faixas indisponíveis no player nativo' : 'Áudio e legendas');
    this.icon(this.fullscreen, fullscreen ? 'exit' : 'fullscreen');
    this.label(this.fullscreen, this.fullscreen.disabled ? 'Tela cheia indisponível' : fullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)');
    this.syncVisibility();
  }

  ownsFocus(node) { return this.overlay.contains(node) || Boolean(this.top?.contains(node)); }

  mustStayVisible() {
    return this.player.mode === 'native' || this.video.paused || this.video.ended || this.loading || Boolean(this.menu)
      || (this.keyboardFocus && this.ownsFocus(this.doc.activeElement))
      || ['#player-recovery', '#live-channel-panel'].some(selector => {
        const node = this.root.querySelector(selector);
        return node && !node.hidden && !node.classList.contains('hidden');
      });
  }

  syncVisibility() {
    if (this.destroyed) return;
    if (this.mustStayVisible()) {
      this.timers.clearTimeout(this.hideTimer); this.hideTimer = null;
      this.root.classList.remove('cinema-idle'); this.overlay.inert = false;
      this.overlay.removeAttribute('aria-hidden');
    } else if (this.hideTimer === null && !this.root.classList.contains('cinema-idle')) {
      this.hideTimer = this.timers.setTimeout(() => {
        this.hideTimer = null;
        if (this.destroyed || this.mustStayVisible()) return;
        this.root.classList.add('cinema-idle'); this.overlay.inert = true;
        this.overlay.setAttribute('aria-hidden', 'true');
      }, 3000);
    }
  }

  show() {
    if (this.destroyed) return;
    this.timers.clearTimeout(this.hideTimer); this.hideTimer = null;
    this.root.classList.remove('cinema-idle'); this.overlay.inert = false;
    this.overlay.removeAttribute('aria-hidden'); this.syncVisibility();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timers.clearTimeout(this.hideTimer); this.hideTimer = null;
    this.closeMenu();
    if (this.doc.fullscreenElement === this.shell) {
      try { Promise.resolve(this.doc.exitFullscreen()).catch(error => this.onError(error)); }
      catch (error) { this.onError(error); }
    }
    for (const remove of this.listeners.splice(0)) remove();
    this.overlay.remove();
    this.root.classList.remove('cinema-player', 'cinema-idle');
    this.video.controls = this.originalControls;
    if (this.top && this.topParent) this.topParent.insertBefore(this.top, this.topNext?.parentNode === this.topParent ? this.topNext : null);
  }
}
