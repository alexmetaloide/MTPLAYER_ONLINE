import { choosePreviewStart } from '../core/preview-start.mjs';
import { ensureMediaEngine } from './media-engines.mjs';

export class WebPlayer {
  constructor({ preview = false, maxPreviewHeight = 480, previewSeconds = 12 } = {}) {
    this.preview = preview;
    this.maxPreviewHeight = maxPreviewHeight;
    this.previewSeconds = previewSeconds;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.video = null;
    this.generation = 0;
    this.pendingCancel = null;
  }

  isCurrent(generation) {
    return generation === this.generation;
  }

  notifyPlaybackError(source, error, generation = this.generation) {
    if (!this.isCurrent(generation)) return;
    try {
      globalThis.dispatchEvent(new CustomEvent('metalloide:playback-error', {
        detail: { source, error: String(error?.message || error || 'Falha de reprodução') }
      }));
    } catch {}
  }

  destroy() {
    this.generation += 1;
    const cancelPending = this.pendingCancel;
    this.pendingCancel = null;
    try { cancelPending?.(); } catch {}
    if (this.hls) {
      try { this.hls.destroy(); } catch {}
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      try { this.mpegtsPlayer.pause(); } catch {}
      try { this.mpegtsPlayer.unload(); } catch {}
      try { this.mpegtsPlayer.detachMediaElement(); } catch {}
      try { this.mpegtsPlayer.destroy(); } catch {}
      this.mpegtsPlayer = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch {}
      this.video.removeAttribute('src');
      try { this.video.load(); } catch {}
      this.video = null;
    }
  }

  async play(video, playback) {
    this.destroy();
    const generation = this.generation;
    this.video = video;
    if (this.preview) video.autoplay = false;
    const format = String(playback.format || '').toLowerCase();
    const isHls = format === 'hls' || /\.m3u8(?:\?|$)/i.test(playback.url);
    const isTs = format === 'ts' || /\.(?:ts|m2ts)(?:\?|$)/i.test(playback.url);
    if (isHls) await ensureMediaEngine('hls');
    else if (isTs) await ensureMediaEngine('ts');
    if (!this.isCurrent(generation)) return;
    if (isHls && globalThis.Hls?.isSupported()) await this.playHls(video, playback, generation);
    else if (isTs && globalThis.mpegts?.isSupported?.()) await this.playMpegTs(video, playback, generation);
    else await this.playDirect(video, playback, generation);
    if (!this.preview || !this.isCurrent(generation)) return;
    await this.preparePreview(video, generation);
    if (this.isCurrent(generation)) await video.play();
  }

  async preparePreview(video, generation) {
    const waitFor = (events, ready, start) => new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        events.forEach(event => video.removeEventListener(event, check));
        video.removeEventListener('error', failed);
        if (this.pendingCancel === cancel) this.pendingCancel = null;
        error ? reject(error) : resolve();
      };
      const check = () => {
        if (!this.isCurrent(generation) || ready()) finish();
      };
      const failed = () => finish(new Error('Não foi possível preparar o trecho da prévia.'));
      const cancel = () => finish();
      this.pendingCancel = cancel;
      events.forEach(event => video.addEventListener(event, check));
      video.addEventListener('error', failed);
      timer = setTimeout(() => finish(new Error('O servidor não permitiu avançar a prévia.')), 8000);
      try { start?.(); check(); } catch (error) { finish(error); }
    });
    await waitFor(['loadedmetadata', 'durationchange'], () => video.readyState >= 1);
    if (!this.isCurrent(generation)) return;
    let duration = video.duration;
    if (!Number.isFinite(duration) && video.seekable?.length) duration = video.seekable.end(video.seekable.length - 1);
    const target = choosePreviewStart(duration, { clipSeconds: this.previewSeconds });
    if (!(target > 0)) throw new Error('Este stream não permite selecionar um trecho da prévia.');
    await waitFor(['seeked', 'canplay'], () => !video.seeking && video.readyState >= 2
      && video.currentTime > 0 && Math.abs(video.currentTime - target) < 1.5,
    () => { video.currentTime = target; });
  }

  async playHls(video, playback, generation) {
    let networkRetries = 0;
    let mediaRetries = 0;
    const headers = playback.headers || {};
    const hls = new globalThis.Hls({
      enableWorker: true,
      lowLatencyMode: !this.preview,
      backBufferLength: this.preview ? 0 : 60,
      maxBufferLength: this.preview ? 6 : 30,
      ...(this.preview ? {
        startLevel: 0,
        maxMaxBufferLength: 8,
        maxBufferSize: 4 * 1024 * 1024,
        maxBufferHole: 0.3
      } : {}),
      fragLoadingMaxRetry: 4,
      manifestLoadingMaxRetry: 3,
      xhrSetup: xhr => {
        for (const [key, value] of Object.entries(headers)) {
          try { xhr.setRequestHeader(key, value); } catch {}
        }
      }
    });
    this.hls = hls;
    hls.loadSource(playback.url);
    hls.attachMedia(video);

    await new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      let ready = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.pendingCancel === cancel) this.pendingCancel = null;
        callback(value);
      };
      const cancel = () => finish(resolve);
      this.pendingCancel = cancel;
      timer = setTimeout(() => {
        if (!this.isCurrent(generation) || this.hls !== hls) return finish(resolve);
        finish(reject, new Error('Tempo esgotado ao abrir o stream HLS.'));
      }, 18000);
      hls.on(globalThis.Hls.Events.MANIFEST_PARSED, () => {
        if (!this.isCurrent(generation) || this.hls !== hls) return finish(resolve);
        if (this.preview && hls.levels?.length) {
          // Keep adaptive previews within SD/HD rather than climbing to 4K.
          let cap = 0;
          for (let index = 0; index < hls.levels.length; index += 1) {
            const level = hls.levels[index];
            if (level.height > 0 && level.height <= this.maxPreviewHeight) cap = index;
          }
          hls.autoLevelCapping = cap;
        }
        ready = true;
        finish(resolve);
      });
      hls.on(globalThis.Hls.Events.ERROR, (_event, data) => {
        if (!this.isCurrent(generation) || this.hls !== hls) return;
        if (!data.fatal) return;
        if (data.type === globalThis.Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
          networkRetries += 1;
          setTimeout(() => {
            if (this.isCurrent(generation) && this.hls === hls) hls.startLoad();
          }, 500 * networkRetries);
          return;
        }
        if (data.type === globalThis.Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1;
          hls.recoverMediaError();
          return;
        }
        if (!ready) {
          finish(reject, new Error(data.details || 'Erro fatal no stream HLS.'));
          return;
        }
        this.notifyPlaybackError('hls', data.details || 'Erro fatal no stream HLS.', generation);
      });
    });
    if (!this.isCurrent(generation) || this.hls !== hls) return;
    if (!this.preview) try { await video.play(); } catch {}
  }

  async playMpegTs(video, playback, generation) {
    const player = globalThis.mpegts.createPlayer({
      type: 'mpegts',
      isLive: !this.preview,
      url: playback.url,
      cors: true,
      withCredentials: false,
      headers: playback.headers || {}
    }, {
      enableWorker: true,
      enableStashBuffer: false,
      lazyLoad: this.preview,
      autoCleanupSourceBuffer: true,
      ...(this.preview ? {
        lazyLoadMaxDuration: 8,
        lazyLoadRecoverDuration: 3,
        autoCleanupMaxBackwardDuration: 6,
        autoCleanupMinBackwardDuration: 2
      } : {})
    });
    this.mpegtsPlayer = player;
    player.attachMediaElement(video);
    player.load();
    await new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      const cleanup = () => video.removeEventListener('loadedmetadata', onReady);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        if (this.pendingCancel === cancel) this.pendingCancel = null;
        callback(value);
      };
      const cancel = () => finish(resolve);
      const onReady = () => {
        if (!this.isCurrent(generation) || this.mpegtsPlayer !== player) return finish(resolve);
        finish(resolve);
      };
      this.pendingCancel = cancel;
      timer = setTimeout(() => {
        if (!this.isCurrent(generation) || this.mpegtsPlayer !== player) return finish(resolve);
        finish(reject, new Error('Tempo esgotado ao abrir MPEG-TS.'));
      }, 18000);
      video.addEventListener('loadedmetadata', onReady, { once: true });
      player.on(globalThis.mpegts.Events.ERROR, (_type, detail) => {
        if (!this.isCurrent(generation) || this.mpegtsPlayer !== player) return;
        const error = new Error(detail || 'Falha ao reproduzir MPEG-TS.');
        if (video.readyState > 0) {
          finish(resolve);
          this.notifyPlaybackError('mpegts', error, generation);
        } else finish(reject, error);
      });
    });
    if (!this.isCurrent(generation) || this.mpegtsPlayer !== player) return;
    if (!this.preview) try { await video.play(); } catch {}
  }

  async playDirect(video, playback, generation) {
    video.src = playback.url;
    await new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', ready);
        video.removeEventListener('error', failed);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        if (this.pendingCancel === cancel) this.pendingCancel = null;
        callback(value);
      };
      const cancel = () => finish(resolve);
      const ready = () => {
        if (!this.isCurrent(generation) || this.video !== video) return finish(resolve);
        finish(resolve);
      };
      const failed = () => {
        if (!this.isCurrent(generation) || this.video !== video) return finish(resolve);
        const error = new Error('Codec ou formato não suportado pelo player atual.');
        if (video.readyState > 0) {
          finish(resolve);
          this.notifyPlaybackError('video', error, generation);
        } else finish(reject, error);
      };
      this.pendingCancel = cancel;
      timer = setTimeout(() => {
        if (!this.isCurrent(generation) || this.video !== video) return finish(resolve);
        finish(reject, new Error('O formato não abriu no player do Chromium.'));
      }, 15000);
      video.addEventListener('loadedmetadata', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
    });
    if (!this.isCurrent(generation) || this.video !== video) return;
    if (!this.preview) try { await video.play(); } catch {}
  }

  tracks(video = this.video) {
    if (this.hls) {
      const audioTracks = Array.from(this.hls.audioTracks || []);
      const subtitleTracks = Array.from(this.hls.subtitleTracks || []);
      return {
        audio: audioTracks.map((track, index) => ({
          id: index,
          language: String(track?.lang || track?.attrs?.LANGUAGE || ''),
          label: String(track?.name || track?.lang || `Áudio ${index + 1}`),
          selected: Number(this.hls.audioTrack) === index
        })),
        subtitles: subtitleTracks.map((track, index) => ({
          id: index,
          language: String(track?.lang || track?.attrs?.LANGUAGE || ''),
          label: String(track?.name || track?.lang || `Legenda ${index + 1}`),
          selected: Boolean(this.hls.subtitleDisplay) && Number(this.hls.subtitleTrack) === index
        }))
      };
    }

    const audioTracks = Array.from(video?.audioTracks || []);
    const textTracks = Array.from(video?.textTracks || []);
    return {
      audio: audioTracks.map((track, index) => ({
        id: index,
        language: String(track?.language || ''),
        label: String(track?.label || track?.language || `Áudio ${index + 1}`),
        selected: Boolean(track?.enabled)
      })),
      subtitles: textTracks.map((track, index) => ({
        id: index,
        language: String(track?.language || ''),
        label: String(track?.label || track?.language || `Legenda ${index + 1}`),
        selected: String(track?.mode || '') === 'showing'
      }))
    };
  }

  selectTrack(type, id, video = this.video) {
    const normalizedType = String(type || '').toLowerCase();
    if (this.hls) {
      if (normalizedType === 'audio') {
        this.hls.audioTrack = Number(id);
        return true;
      }
      if (normalizedType === 'subtitle') {
        const index = Number(id);
        if (index < 0) {
          this.hls.subtitleDisplay = false;
          this.hls.subtitleTrack = -1;
        } else {
          this.hls.subtitleDisplay = true;
          this.hls.subtitleTrack = index;
        }
        return true;
      }
      return false;
    }

    if (normalizedType === 'audio') {
      const tracks = Array.from(video?.audioTracks || []);
      tracks.forEach((track, index) => { track.enabled = index === Number(id); });
      return tracks.length > 0;
    }
    if (normalizedType === 'subtitle') {
      const tracks = Array.from(video?.textTracks || []);
      const selected = Number(id);
      tracks.forEach((track, index) => { track.mode = selected >= 0 && index === selected ? 'showing' : 'disabled'; });
      return true;
    }
    return false;
  }
}
