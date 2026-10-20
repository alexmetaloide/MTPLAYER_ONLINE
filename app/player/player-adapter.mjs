import { WebPlayer } from './web-player.mjs';
export const PLAYBACK_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5]);

export class PlayerAdapter {
  constructor() {
    this.engine = new WebPlayer();
    this.mode = 'web';
    this.generation = 0;
  }

  isCurrent(generation) {
    return generation === this.generation;
  }

  async play(video, playback) {
    const generation = ++this.generation;
    const nativePlayer = globalThis.desktopAPI?.nativePlayer;
    const format = String(playback?.format || '').toLowerCase();
    const isTs = format === 'ts' || /\.(?:ts|m2ts)(?:\?|$)/i.test(String(playback?.url || ''));
    if (nativePlayer?.play && isTs) {
      this.engine.destroy();
      if (!this.isCurrent(generation)) return;
      this.mode = 'native';
      await nativePlayer.play(playback);
      return;
    }

    try {
      this.mode = 'web';
      await this.engine.play(video, playback);
      return;
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (!nativePlayer?.play) throw error;
      this.engine.destroy();
      if (!this.isCurrent(generation)) return;
      this.mode = 'native';
      await nativePlayer.play(playback);
    }
  }

  async progress(video) {
    if (this.mode === 'native' && globalThis.desktopAPI?.nativePlayer?.state) {
      const state = await globalThis.desktopAPI.nativePlayer.state();
      return {
        position: Math.max(0, Number(state?.positionMs) || 0) / 1000,
        duration: Math.max(0, Number(state?.durationMs) || 0) / 1000,
        ended: Boolean(state?.ended),
        paused: Boolean(state?.paused) || String(state?.playbackState || '').toUpperCase() === 'PAUSED'
      };
    }

    return {
      position: Math.max(0, Number(video?.currentTime) || 0),
      duration: Number.isFinite(video?.duration) ? Math.max(0, video.duration) : 0,
      ended: Boolean(video?.ended),
      paused: Boolean(video?.paused)
    };
  }

  async seek(video, seconds) {
    const position = Math.max(0, Number(seconds) || 0);
    if (this.mode === 'native' && globalThis.desktopAPI?.nativePlayer?.seekTo) {
      await globalThis.desktopAPI.nativePlayer.seekTo(Math.round(position * 1000));
      return;
    }
    if (!video) return;
    if (!video.readyState) {
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', done);
          video.removeEventListener('error', done);
          resolve();
        };
        const timer = setTimeout(done, 5000);
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', done, { once: true });
      });
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = duration > 1 ? Math.min(position, duration - 1) : position;
  }

  async togglePlayback(video) {
    const nativePlayer = globalThis.desktopAPI?.nativePlayer;
    if (this.mode === 'native' && nativePlayer?.state) {
      const state = await nativePlayer.state();
      const paused = Boolean(state?.paused) || String(state?.playbackState || '').toUpperCase() === 'PAUSED';
      if (paused) {
        if (!nativePlayer.resume) return { paused: true };
        await nativePlayer.resume();
        return { paused: false };
      }
      if (!nativePlayer.pause) return { paused: false };
      await nativePlayer.pause();
      return { paused: true };
    }

    if (!video) return { paused: false };
    if (video.paused) {
      await video.play();
      return { paused: false };
    }
    video.pause();
    return { paused: true };
  }

  async pausePlayback(video) {
    const nativePlayer = globalThis.desktopAPI?.nativePlayer;
    if (this.mode === 'native') {
      if (!nativePlayer?.pause) return { paused: false };
      await nativePlayer.pause();
      return { paused: true };
    }
    if (!video) return { paused: false };
    if (!video.paused) video.pause();
    return { paused: true };
  }

  async resumePlayback(video) {
    const nativePlayer = globalThis.desktopAPI?.nativePlayer;
    if (this.mode === 'native') {
      if (!nativePlayer?.resume) return { paused: true };
      await nativePlayer.resume();
      return { paused: false };
    }
    if (!video) return { paused: true };
    if (video.paused) await video.play();
    return { paused: false };
  }

  async stop() {
    const generation = ++this.generation;
    this.engine.destroy();
    const nativeStop = globalThis.desktopAPI?.nativePlayer?.stop;
    if (nativeStop) {
      try { await nativeStop(); } catch {}
    }
    if (!this.isCurrent(generation)) return;
    this.mode = 'web';
  }

  async tracks(video) {
    if (this.mode === 'native' && globalThis.desktopAPI?.nativePlayer?.tracks) {
      try { return await globalThis.desktopAPI.nativePlayer.tracks(); } catch {}
    }
    return this.engine.tracks(video);
  }

  supportsPlaybackRate(video) {
    return this.mode === 'web' && Boolean(video) && typeof video.playbackRate === 'number';
  }

  async setPlaybackRate(video, rate) {
    if (!PLAYBACK_RATES.includes(rate) || !this.supportsPlaybackRate(video)) throw new Error('Velocidade indisponível neste player.');
    video.preservesPitch = true;
    video.playbackRate = rate;
    if (Math.abs(video.playbackRate - rate) > 0.01) throw new Error('Velocidade não suportada.');
    return rate;
  }

  async selectTrack(type, id, video) {
    if (this.mode === 'native' && globalThis.desktopAPI?.nativePlayer?.selectTrack) {
      return globalThis.desktopAPI.nativePlayer.selectTrack(type, id);
    }
    return this.engine.selectTrack(type, id, video);
  }

  destroy() {
    this.generation += 1;
    this.engine.destroy();
    globalThis.desktopAPI?.nativePlayer?.stop?.().catch?.(() => {});
    this.mode = 'web';
  }

  capabilities() {
    return {
      hls: Boolean(globalThis.Hls?.isSupported?.()),
      mpegTs: Boolean(globalThis.mpegts?.isSupported?.()),
      nativeVideo: true,
      androidNativeFallback: Boolean(globalThis.desktopAPI?.nativePlayer?.play)
    };
  }
}
