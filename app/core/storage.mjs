import { safeJsonParse } from './utils.mjs';

export function loadSettings() {
  const stored = safeJsonParse(localStorage.getItem('settings'), {});
  return {
    streamType: ['auto', 'hls', 'original'].includes(stored.streamType) ? stored.streamType : 'auto',
    videoSize: ['contain', 'cover'].includes(stored.videoSize) ? stored.videoSize : 'contain',
    pageSize: Math.min(Math.max(Number(stored.pageSize) || 120, 40), 240),
    nextEpisodeSeconds: [60, 90, 120].includes(Number(stored.nextEpisodeSeconds)) ? Number(stored.nextEpisodeSeconds) : 90
  };
}

export function saveSettings(settings) {
  localStorage.setItem('settings', JSON.stringify({
    streamType: settings.streamType,
    videoSize: settings.videoSize,
    pageSize: settings.pageSize,
    nextEpisodeSeconds: settings.nextEpisodeSeconds
  }));
}

export function loadRawFavorites() {
  const value = safeJsonParse(localStorage.getItem('favorites'), []);
  return Array.isArray(value) ? value : [];
}

export function saveFavorites(favorites) {
  localStorage.setItem('favorites', JSON.stringify(favorites));
}

export function loadRawHistory() {
  const value = safeJsonParse(localStorage.getItem('playbackHistory'), []);
  return Array.isArray(value) ? value : [];
}

export function saveHistory(history) {
  localStorage.setItem('playbackHistory', JSON.stringify(history));
}

export function loadRawProfiles() {
  const value = safeJsonParse(localStorage.getItem('profilesV1'), {});
  return value && typeof value === 'object' ? value : {};
}

export function saveProfiles(profileState) {
  localStorage.setItem('profilesV1', JSON.stringify(profileState || {}));
}
