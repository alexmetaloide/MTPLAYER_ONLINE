(() => {
  if (!globalThis.AndroidBridge) return;

  try {
    const deviceClass = globalThis.AndroidBridge.deviceClass?.() === 'tv' ? 'tv' : 'mobile';
    document.documentElement.classList.add(`android-${deviceClass}`);
    const mobileStyles = document.getElementById('android-mobile-styles');
    const tvStyles = document.getElementById('android-tv-styles');
    if (mobileStyles && deviceClass === 'mobile') mobileStyles.media = 'all';
    if (tvStyles && deviceClass === 'tv') tvStyles.media = 'all';
  } catch {
    document.documentElement.classList.add('android-mobile');
    const mobileStyles = document.getElementById('android-mobile-styles');
    if (mobileStyles) mobileStyles.media = 'all';
  }

  let sequence = 0;
  const pending = new Map();

  globalThis.__androidResolve = (requestId, payload) => {
    const job = pending.get(requestId);
    if (!job) return;
    pending.delete(requestId);
    try {
      const envelope = JSON.parse(payload);
      if (envelope.ok) job.resolve(envelope.value);
      else job.reject(new Error(envelope.error || 'Falha no serviço Android.'));
    } catch (error) {
      job.reject(error);
    }
  };

  function invoke(method, ...args) {
    return new Promise((resolve, reject) => {
      const requestId = `a${Date.now().toString(36)}-${(++sequence).toString(36)}`;
      pending.set(requestId, { resolve, reject });
      try {
        globalThis.AndroidBridge.invoke(requestId, method, JSON.stringify(args));
      } catch (error) {
        pending.delete(requestId);
        reject(error);
      }
    });
  }

  globalThis.desktopAPI = Object.freeze({
    getAppInfo: () => invoke('app:info'),
    exit: () => invoke('app:exit'),
    accounts: Object.freeze({
      list: () => invoke('accounts:list'),
      save: draft => invoke('accounts:save', draft),
      activate: id => invoke('accounts:activate', id),
      remove: id => invoke('accounts:remove', id)
    }),
    catalog: Object.freeze({
      summary: () => invoke('catalog:summary'),
      get: (kind, options = {}) => invoke('catalog:get', kind, options),
      refreshAll: () => invoke('catalog:refreshAll'),
      episodes: ref => invoke('catalog:episodes', ref),
      details: ref => invoke('catalog:details', ref)
    }),
    playback: Object.freeze({
      get: (ref, preferred = 'auto') => invoke('playback:get', ref, preferred)
    }),
    nativePlayer: Object.freeze({
      play: playback => invoke('player:native:play', playback),
      stop: () => invoke('player:native:stop'),
      state: () => invoke('player:native:state'),
      seekTo: positionMs => invoke('player:native:seek', positionMs),
      pause: () => invoke('player:native:pause'),
      resume: () => invoke('player:native:resume'),
      tracks: () => invoke('player:native:tracks'),
      selectTrack: (type, id) => invoke('player:native:selectTrack', type, id)
    }),
    epg: Object.freeze({
      getMany: ids => invoke('epg:getMany', ids),
      getArchive: ref => invoke('epg:getArchive', ref)
    }),
    backup: Object.freeze({
      export: data => invoke('backup:export', data),
      import: () => invoke('backup:import')
    }),
    updates: Object.freeze({
      check: () => invoke('update:check')
    }),
    log: (level, message) => invoke('log:renderer', level, message)
  });
})();
