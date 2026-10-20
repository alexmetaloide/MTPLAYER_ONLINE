function cleanString(value, max = 500) {
  return String(value ?? '').slice(0, max);
}

function sanitizeFavorite(value = {}) {
  const allowedKinds = new Set(['live', 'vod', 'series', 'radio']);
  const kind = allowedKinds.has(value.kind) ? value.kind : 'live';
  const result = {
    accountId: cleanString(value.accountId, 80),
    profileId: cleanString(value.profileId, 140),
    kind,
    id: cleanString(value.id, 200),
    sourceId: cleanString(value.sourceId, 200),
    name: cleanString(value.name, 300),
    // Covers may contain provider tokens. A portable backup never includes URLs.
    image: '',
    categoryId: cleanString(value.categoryId, 300),
    year: cleanString(value.year, 20),
    savedAt: safeNumber(value.savedAt),
    containerExtension: cleanString(value.containerExtension, 20)
  };
  result.key = `${result.accountId}:${result.profileId}:${result.kind}:${result.id || result.sourceId || result.name}`;
  return result;
}

function sanitizeSettings(value = {}) {
  return {
    streamType: ['auto', 'hls', 'original'].includes(value.streamType) ? value.streamType : 'auto',
    videoSize: ['contain', 'cover'].includes(value.videoSize) ? value.videoSize : 'contain',
    pageSize: Math.min(Math.max(Number(value.pageSize) || 120, 40), 240),
    nextEpisodeSeconds: [60, 90, 120].includes(Number(value.nextEpisodeSeconds)) ? Number(value.nextEpisodeSeconds) : 90
  };
}

function safeNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function sanitizeHistoryEntry(value = {}) {
  const sourceItem = value.item && typeof value.item === 'object' ? value.item : value;
  const kind = ['vod', 'series'].includes(sourceItem.kind) ? sourceItem.kind : '';
  const accountId = cleanString(value.accountId, 80);
  const profileId = cleanString(value.profileId, 140);
  const id = cleanString(sourceItem.id, 200);
  if (!accountId || !kind || !id) return null;

  const item = {
    id,
    kind,
    name: cleanString(sourceItem.name || 'Conteúdo', 300),
    image: '',
    categoryId: cleanString(sourceItem.categoryId, 300),
    genre: cleanString(sourceItem.genre, 500),
    seriesId: cleanString(sourceItem.seriesId, 200),
    seriesName: cleanString(sourceItem.seriesName, 300),
    containerExtension: cleanString(sourceItem.containerExtension, 20),
    season: cleanString(sourceItem.season, 40),
    episode: cleanString(sourceItem.episode, 40),
    year: cleanString(sourceItem.year, 20),
    rating: cleanString(sourceItem.rating, 20)
  };

  return {
    key: `${accountId}:${profileId}:${kind}:${id}`,
    accountId,
    profileId,
    item,
    position: safeNumber(value.position),
    duration: safeNumber(value.duration),
    completed: Boolean(value.completed),
    hiddenFromContinue: Boolean(value.hiddenFromContinue),
    updatedAt: safeNumber(value.updatedAt)
  };
}

function sanitizeProfiles(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const profiles = (Array.isArray(source.profiles) ? source.profiles : []).slice(0, 100).map(profile => ({
    id: cleanString(profile?.id, 140),
    accountId: cleanString(profile?.accountId, 80),
    name: cleanString(profile?.name || 'Perfil', 40),
    avatar: ['blue', 'yellow', 'purple', 'orange', 'pink'].includes(profile?.avatar) ? profile.avatar : 'blue',
    kidsMode: Boolean(profile?.kidsMode),
    blockedTitles: (Array.isArray(profile?.blockedTitles) ? profile.blockedTitles : []).slice(-1000)
      .filter(row => row && ['vod', 'series'].includes(row.kind) && row.id)
      .map(row => ({ kind: row.kind, id: cleanString(row.id, 200), name: cleanString(row.name || 'Título', 300), year: cleanString(row.year, 20) })),
    playback: { previews: profile?.playback?.previews !== false, previewAutoplay: profile?.playback?.previewAutoplay !== false,
      nextEpisodeAutoplay: profile?.playback?.nextEpisodeAutoplay !== false, inactivityCheck: profile?.playback?.inactivityCheck !== false },
    createdAt: safeNumber(profile?.createdAt),
    updatedAt: safeNumber(profile?.updatedAt)
  })).filter(profile => profile.id && profile.accountId);
  const activeByAccount = Object.create(null);
  if (source.activeByAccount && typeof source.activeByAccount === 'object') {
    for (const [accountId, profileId] of Object.entries(source.activeByAccount)) {
      const account = cleanString(accountId, 80);
      const profile = cleanString(profileId, 140);
      if (account && profile) activeByAccount[account] = profile;
    }
  }
  return { version: 1, profiles, activeByAccount };
}

function sanitizeBackup(data = {}) {
  const favorites = Array.isArray(data.favorites) ? data.favorites.slice(0, 5000).map(sanitizeFavorite) : [];
  const history = Array.isArray(data.history)
    ? data.history.slice(0, 600).map(sanitizeHistoryEntry).filter(Boolean)
    : [];
  const ratings = {};
  for (const [key, values] of Object.entries(data.ratings && typeof data.ratings === 'object' ? data.ratings : {}).slice(0, 100)) {
    if (!key.startsWith('mtplayer-ratings-v1:') || key.length >= 1000) continue;
    ratings[key] = (Array.isArray(values) ? values : []).slice(-2000)
      .filter(row => ['vod', 'series'].includes(row?.kind) && row.id && [1, 2, -1].includes(row.value))
      .map(row => ({ kind: row.kind, id: cleanString(row.id, 200), value: row.value }));
  }
  return { version: 6, favorites, history, ratings, settings: sanitizeSettings(data.settings || {}), profiles: sanitizeProfiles(data.profiles || {}) };
}

export { cleanString, sanitizeFavorite, sanitizeSettings, sanitizeHistoryEntry, sanitizeProfiles, sanitizeBackup };
