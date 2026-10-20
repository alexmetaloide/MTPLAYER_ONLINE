import { titleIdentity } from './preview-selection.mjs';
const indexes = new WeakMap();
export function sanitizeBlockedTitles(values) {
  const result = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    if (!row || !['vod', 'series'].includes(row.kind) || !row.id) continue;
    const item = { kind: row.kind, id: String(row.id).slice(0, 200), name: String(row.name || 'Título').slice(0, 300), year: String(row.year || '').slice(0, 20) };
    result.set(`${item.kind}:${item.id}`, item);
  }
  return [...result.values()].slice(-1000);
}
export function blockTitle(values, item) {
  return sanitizeBlockedTitles([...sanitizeBlockedTitles(values), item]);
}
export function unblockTitle(values, item) {
  return sanitizeBlockedTitles(values).filter(row => row.kind !== item.kind || row.id !== String(item.id));
}
export function isTitleBlocked(profile, item) {
  if (!profile || !item || !['vod', 'series'].includes(item.kind) || !profile.blockedTitles?.length) return false;
  let index = indexes.get(profile);
  if (!index) {
    index = { ids: new Set(), titles: new Map() };
    for (const row of sanitizeBlockedTitles(profile.blockedTitles)) {
      index.ids.add(`${row.kind}:${row.id}`);
      if (!row.name || row.name === 'Título') continue;
      const identity = titleIdentity(row);
      const key = `${row.kind}:${identity.title}`;
      if (!index.titles.has(key)) index.titles.set(key, new Set());
      index.titles.get(key).add(identity.year);
    }
    indexes.set(profile, index);
  }
  const id = item.kind === 'series' ? item.seriesId || item.id : item.id;
  if (index.ids.has(`${item.kind}:${id}`)) return true;
  const identity = titleIdentity(item.kind === 'series' && item.seriesName ? { ...item, name: item.seriesName } : item);
  const years = index.titles.get(`${item.kind}:${identity.title}`);
  return Boolean(years && (!identity.year || years.has('') || years.has(identity.year)));
}
