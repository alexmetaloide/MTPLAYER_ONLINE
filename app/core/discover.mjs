import { isRestrictedLabel, restrictedCategoryIds } from './parental-control.mjs';
import { selectPreviewEditions } from './preview-selection.mjs';
import { feedCategoryFilter } from './feed-categories.mjs';

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Pick profile-aware titles from the user's own catalog, without an external API. */
export function buildDiscoverFeed(catalogs, { favorites = [], history = [], accountId = '', profileId = '', day = '', limit = 60, category = 'all' } = {}) {
  const matchesCategory = feedCategoryFilter(category);
  const kinds = ['vod', 'series'];
  const preferredCategories = new Set();
  const recentlyWatched = new Set();
  const filterScope = entry => entry?.accountId === accountId && entry?.profileId === profileId;
  for (const favorite of favorites.filter(filterScope)) if (favorite.categoryId) preferredCategories.add(String(favorite.categoryId));
  for (const entry of history.filter(filterScope)) {
    if (entry?.item?.categoryId) preferredCategories.add(String(entry.item.categoryId));
    if (entry?.item?.id) recentlyWatched.add(`${entry.item.kind}:${entry.item.id}`);
  }

  const buckets = { vod: [], series: [] };
  const unique = new Set();
  for (const kind of kinds) {
    const catalog = catalogs?.[kind] || {};
    const blockedCategories = restrictedCategoryIds(catalog.categories || []);
    const candidates = (catalog.items || []).filter(item => item && item.id && item.name
      && matchesCategory(item, kind)
      && !blockedCategories.has(String(item.categoryId || ''))
      && ![item.name, item.categoryId, item.genre, item.plot].some(isRestrictedLabel));
    for (const item of selectPreviewEditions(candidates.map(item => ({ ...item, kind })), catalog.categories || [])) {
      const key = `${kind}:${item.id}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const rating = Math.max(0, Math.min(10, Number(String(item.rating || '').replace(',', '.')) || 0));
      const randomized = stableHash(`${profileId}:${day}:${key}`) % 64;
      const score = randomized + rating * 3 + (item.image || item.backdrop ? 12 : 0)
        + (preferredCategories.has(String(item.categoryId || '')) ? 35 : 0)
        - (recentlyWatched.has(key) ? 32 : 0);
      buckets[kind].push({ ...item, kind, discoverScore: score });
    }
    buckets[kind].sort((a, b) => b.discoverScore - a.discoverScore);
  }

  const result = [];
  const slots = ['vod', 'series', 'vod'];
  let cursor = 0;
  const maximum = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
  while (result.length < maximum && (buckets.vod.length || buckets.series.length)) {
    const preferred = slots[cursor % slots.length];
    const next = buckets[preferred].length ? preferred : (preferred === 'vod' ? 'series' : 'vod');
    result.push(buckets[next].shift());
    cursor += 1;
  }
  return result;
}
