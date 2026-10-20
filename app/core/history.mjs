const MAX_HISTORY = 600;

function clampNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function sanitizeItem(item = {}) {
  return {
    id: String(item.id ?? ''),
    kind: String(item.kind ?? ''),
    name: String(item.name ?? 'Conteúdo'),
    image: String(item.image ?? ''),
    categoryId: String(item.categoryId ?? ''),
    genre: String(item.genre ?? ''),
    seriesId: String(item.seriesId ?? ''),
    seriesName: String(item.seriesName ?? ''),
    containerExtension: String(item.containerExtension ?? ''),
    season: String(item.season ?? ''),
    episode: String(item.episode ?? ''),
    year: String(item.year ?? ''),
    rating: String(item.rating ?? '')
  };
}

export function playbackHistoryKey(item, accountId, profileId = '') {
  const safe = sanitizeItem(item);
  return [String(accountId || ''), String(profileId || ''), safe.kind, safe.id].join(':');
}

export function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const accountId = String(entry.accountId || '');
  const profileId = String(entry.profileId || '');
  const item = sanitizeItem(entry.item || entry);
  if (!accountId || !item.id || !['vod', 'series'].includes(item.kind)) return null;

  const position = clampNumber(entry.position, 0);
  const duration = clampNumber(entry.duration, 0);
  const updatedAt = clampNumber(entry.updatedAt, 0);
  const completed = Boolean(entry.completed);

  return {
    key: playbackHistoryKey(item, accountId, profileId),
    accountId,
    profileId,
    item,
    position,
    duration,
    completed,
    hiddenFromContinue: Boolean(entry.hiddenFromContinue),
    updatedAt
  };
}

export function migrateHistory(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const byKey = new Map();

  for (const value of source) {
    const entry = sanitizeHistoryEntry(value);
    if (!entry) continue;
    const previous = byKey.get(entry.key);
    if (!previous || entry.updatedAt >= previous.updatedAt) byKey.set(entry.key, entry);
  }

  return [...byKey.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY);
}

export function findHistoryEntry(history, item, accountId, profileId = '') {
  const key = playbackHistoryKey(item, accountId, profileId);
  return (history || []).find(entry => entry.key === key) || null;
}

export function updatePlaybackHistory(history, item, accountId, progress = {}, now = Date.now(), profileId = '') {
  const safeItem = sanitizeItem(item);
  if (!accountId || !safeItem.id || !['vod', 'series'].includes(safeItem.kind)) {
    return migrateHistory(history);
  }

  const position = clampNumber(progress.position, 0);
  const duration = clampNumber(progress.duration, 0);
  const ended = Boolean(progress.ended);
  const completionThreshold = duration > 0 ? Math.max(duration * 0.95, duration - 45) : Number.POSITIVE_INFINITY;
  const completed = ended || (duration > 0 && position >= completionThreshold);

  const entry = sanitizeHistoryEntry({
    accountId,
    profileId,
    item: safeItem,
    position: completed ? duration || position : position,
    duration,
    completed,
    updatedAt: now
  });

  const next = (history || []).filter(value => value?.key !== entry.key);
  next.unshift(entry);
  return migrateHistory(next);
}

export function activeHistory(history, accountId, profileId = '') {
  const targetAccount = String(accountId || '');
  const targetProfile = String(profileId || '');
  return migrateHistory(history).filter(entry => entry.accountId === targetAccount && entry.profileId === targetProfile);
}

export function removeHistoryEntry(history, key) {
  return migrateHistory((history || []).filter(entry => entry?.key !== String(key || '')));
}

export function clearHistoryForAccount(history, accountId, profileId = null) {
  const target = String(accountId || '');
  if (!target) return migrateHistory(history);
  if (profileId == null) return migrateHistory((history || []).filter(entry => entry?.accountId !== target));
  const targetProfile = String(profileId || '');
  return migrateHistory((history || []).filter(entry => entry?.accountId !== target || entry?.profileId !== targetProfile));
}

export function continueWatching(history, accountId, limit = 8, profileId = '') {
  const seen = new Set();
  const result = [];
  for (const entry of activeHistory(history, accountId, profileId)) {
    const key = continueGroupKey(entry.item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.completed || entry.hiddenFromContinue || entry.position < 10) continue;
    result.push(entry);
    if (result.length >= Math.max(1, Number(limit) || 8)) break;
  }
  return result;
}

function continueGroupKey(item) {
  return `${item.kind}:${item.kind === 'series' ? item.seriesId || item.id : item.id}`;
}

export function hideFromContinue(history, entry) {
  const group = continueGroupKey(entry.item);
  return migrateHistory(history).map(row => row.accountId === entry.accountId && row.profileId === entry.profileId
    && continueGroupKey(row.item) === group ? { ...row, hiddenFromContinue: true } : row);
}

export function filterHistoryEntries(entries, filter = 'all') {
  const source = Array.isArray(entries) ? entries : [];
  if (filter === 'progress') return source.filter(entry => !entry.completed && entry.position >= 10);
  if (filter === 'completed') return source.filter(entry => entry.completed);
  return source;
}

function normalizeHistorySearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function searchHistoryEntries(entries, query = '') {
  const source = Array.isArray(entries) ? entries : [];
  const term = normalizeHistorySearch(query);
  if (!term) return source;

  return source.filter(entry => {
    const item = entry?.item || {};
    const searchable = [
      item.name,
      item.year,
      item.season,
      item.episode
    ].map(normalizeHistorySearch).join(' ');
    return searchable.includes(term);
  });
}

export function historyProgressPercent(entry) {
  if (!entry || !entry.duration) return 0;
  return Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100)));
}

export function formatPlaybackTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  if (minutes) return `${minutes}min`;
  return `${secs}s`;
}
