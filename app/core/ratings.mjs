export const RATING_VALUES = [1, 2, -1];
const prefix = 'mtplayer-ratings-v1:';
export function ratingStorageKey(accountId, profileId) {
  return `${prefix}${encodeURIComponent(accountId || '')}:${encodeURIComponent(profileId || '')}`;
}
export function sanitizeRatings(raw) {
  const result = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!['vod', 'series'].includes(row?.kind) || !row.id || !RATING_VALUES.includes(row.value)) continue;
    const item = { kind: row.kind, id: String(row.id), value: row.value };
    result.set(`${item.kind}:${item.id}`, item);
  }
  return [...result.values()].slice(-2000);
}
export function loadProfileRatings(storage, accountId, profileId) {
  if (!accountId) return [];
  const key = ratingStorageKey(accountId, profileId);
  try {
    const existing = storage.getItem(key);
    if (existing !== null) return sanitizeRatings(JSON.parse(existing));
    const legacyKey = `mtplayer-preview-likes-v1:${encodeURIComponent(accountId)}:${encodeURIComponent(profileId || '')}`;
    const legacy = JSON.parse(storage.getItem(legacyKey) || '[]');
    const rows = sanitizeRatings((Array.isArray(legacy) ? legacy : []).map(value => {
      const match = String(value).match(/^(vod|series):(.+)$/);
      return match ? { kind: match[1], id: match[2], value: 1 } : null;
    }));
    storage.setItem(key, JSON.stringify(rows));
    return rows;
  } catch { return []; }
}
export function updateRating(rows, item, value) {
  const next = sanitizeRatings(rows).filter(row => row.kind !== item.kind || row.id !== String(item.id));
  if (RATING_VALUES.includes(value)) next.push({ kind: item.kind, id: String(item.id), value });
  return sanitizeRatings(next);
}
export function ratingValue(rows, item) {
  return rows.find(row => row.kind === item.kind && row.id === String(item.id))?.value || 0;
}
export function exportRatings(storage) {
  const result = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try { result[key] = sanitizeRatings(JSON.parse(storage.getItem(key))); } catch {}
  }
  return result;
}
export function importRatings(storage, values) {
  if (!values || typeof values !== 'object') return;
  for (const [key, rows] of Object.entries(values)) {
    if (key.startsWith(prefix) && key.length < 1000) storage.setItem(key, JSON.stringify(sanitizeRatings(rows)));
  }
}
