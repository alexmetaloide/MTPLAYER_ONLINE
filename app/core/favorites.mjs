const allowedKinds = new Set(['live', 'vod', 'series', 'radio']);

export function sanitizeFavorite(item = {}, accountId = '', profileId = '') {
  const kind = allowedKinds.has(item.kind) ? item.kind : 'live';
  const favorite = {
    accountId: String(item.accountId || accountId || '').slice(0, 80),
    profileId: String(item.profileId || profileId || '').slice(0, 140),
    kind,
    id: String(item.id || '').slice(0, 200),
    sourceId: String(item.sourceId || '').slice(0, 200),
    name: String(item.name || '').slice(0, 300),
    image: String(item.image || '').slice(0, 2000),
    categoryId: String(item.categoryId || '').slice(0, 300),
    year: String(item.year || '').slice(0, 20),
    savedAt: Number.isFinite(Number(item.savedAt)) ? Math.max(0, Number(item.savedAt)) : 0,
    containerExtension: String(item.containerExtension || '').slice(0, 20)
  };
  favorite.key = `${favorite.accountId}:${favorite.profileId}:${favorite.kind}:${favorite.id || favorite.sourceId || favorite.name}`;
  return favorite;
}

export function migrateFavorites(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => sanitizeFavorite(item, item.accountId || '', item.profileId || ''))
    .filter(item => item.name && (item.id || item.sourceId));
}

export function isFavorite(favorites, item, accountId, profileId = '') {
  const key = sanitizeFavorite(item, accountId, profileId).key;
  return favorites.some(favorite => favorite.key === key);
}

export function toggleFavorite(favorites, item, accountId, profileId = '') {
  const favorite = sanitizeFavorite(item, accountId, profileId);
  const index = favorites.findIndex(value => value.key === favorite.key);
  if (index >= 0) {
    favorites.splice(index, 1);
    return false;
  }
  favorites.push({ ...favorite, savedAt: Date.now() });
  return true;
}
