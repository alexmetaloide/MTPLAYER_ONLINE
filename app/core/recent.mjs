import { isRestrictedLabel, restrictedCategoryIds } from './parental-control.mjs';
import { selectPreviewEditions } from './preview-selection.mjs';
import { buildFeedCategories, feedCategoryFilter } from './feed-categories.mjs';

const DAY_MS = 86_400_000;
export const RECENT_DAYS = 60;

export function recentStorageKey(accountId) {
  return `mtplayer-recent-v1:${encodeURIComponent(String(accountId || ''))}`;
}

/** Catalog inclusion time, never a movie release date or series last_modified. */
export function parseCatalogAddedAt(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  let timestamp;
  if (/^\d{10}$/.test(raw)) timestamp = Number(raw) * 1000;
  else if (/^\d{13}$/.test(raw)) timestamp = Number(raw);
  else if (/^\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d)?(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?)?$/.test(raw)) {
    timestamp = Date.parse(raw.replace(' ', 'T'));
  } else return null;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/**
 * Keep a per-account inventory of previously observed titles. A playlist without
 * reliable addition dates starts with a baseline; only subsequently seen IDs count
 * as newly added. Missing dates do not turn the whole catalog into "recent".
 */
export function buildRecentFeed(catalogs, previous = null, { now = Date.now(), days = RECENT_DAYS, limit = 70, category = 'all', detectNew = true } = {}) {
  const matchesCategory = feedCategoryFilter(category);
  const eligibleCatalogs = {};
  const windowMs = Math.max(1, days) * DAY_MS;
  const cutoff = now - windowMs;
  const initializedKinds = new Set(Array.isArray(previous?.initializedKinds) ? previous.initializedKinds : []);
  const seen = new Set(Array.isArray(previous?.seen) ? previous.seen : []);
  const detected = {};
  for (const [key, time] of Object.entries(previous?.detected || {})) {
    if (Number.isFinite(time) && time >= cutoff && time <= now) detected[key] = time;
  }

  const results = [];
  const unique = new Set();
  for (const kind of ['vod', 'series']) {
    const catalog = catalogs?.[kind];
    if (!catalog || !Array.isArray(catalog.items)) continue;
    const hasBaseline = initializedKinds.has(kind);
    const restrictedIds = restrictedCategoryIds(catalog.categories || []);
    const candidates = [];
    for (const item of catalog.items) {
      if (!item?.id || !item?.name) continue;
      const key = `${kind}:${item.id}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const alreadySeen = seen.has(key);
      seen.add(key);
      const officialDate = parseCatalogAddedAt(item.addedAt);
      if (detectNew && officialDate == null && hasBaseline && !alreadySeen) detected[key] = now;
      const addedTime = officialDate ?? detected[key];
      if (addedTime == null || addedTime < cutoff || addedTime > now + DAY_MS
        || restrictedIds.has(String(item.categoryId || ''))
        || [item.name, item.categoryId, item.genre, item.plot].some(isRestrictedLabel)) continue;
      candidates.push({ ...item, kind, recentAddedAt: addedTime });
    }
    eligibleCatalogs[kind] = { categories: catalog.categories || [], items: candidates };
    results.push(...selectPreviewEditions(candidates.filter(item => matchesCategory(item)), catalog.categories || []));
    initializedKinds.add(kind);
  }
  results.sort((a, b) => b.recentAddedAt - a.recentAddedAt
    || a.name.localeCompare(b.name, 'pt-BR') || a.kind.localeCompare(b.kind));
  return {
    items: results.slice(0, Math.max(0, Math.floor(limit))),
    categories: buildFeedCategories(eligibleCatalogs),
    snapshot: { initializedKinds: [...initializedKinds], seen: [...seen], detected }
  };
}
