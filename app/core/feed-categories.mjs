import { isRestrictedLabel, restrictedCategoryIds } from './parental-control.mjs';
import { isSubtitledPreview } from './preview-selection.mjs';

export const ALL_FEED_CATEGORIES = 'all';
export const feedCategoryValue = (kind, id) => JSON.stringify([kind, String(id ?? '')]);

/** IDs are scoped by content kind: Xtream may reuse the same ID for films and series. */
export function feedCategoryFilter(value = ALL_FEED_CATEGORIES) {
  if (value === ALL_FEED_CATEGORIES) return () => true;
  try {
    const pair = JSON.parse(value);
    if (Array.isArray(pair) && pair.length === 2 && ['vod', 'series'].includes(pair[0]) && typeof pair[1] === 'string') {
      return (item, kind = item.kind) => (typeof kind === 'string' ? kind : item.kind) === pair[0]
        && String(item.categoryId ?? '') === pair[1];
    }
  } catch {}
  return () => false;
}

/** Show actual categories with eligible titles, including ones beyond the initial feed limit. */
export function buildFeedCategories(catalogs) {
  const result = [];
  for (const kind of ['vod', 'series']) {
    const catalog = catalogs?.[kind] || {};
    const names = new Map((catalog.categories || []).map(category => [String(category.id), category.name]));
    const restricted = restrictedCategoryIds(catalog.categories || []);
    const categories = new Map();
    for (const item of catalog.items || []) {
      if (!item?.id || !item.name) continue;
      const id = String(item.categoryId ?? '');
      const name = names.get(id) || item.categoryName || id || 'Sem categoria';
      if (restricted.has(id) || [item.name, id, item.genre, item.plot, name].some(isRestrictedLabel)
        || isSubtitledPreview(item, name)) continue;
      categories.set(id, { kind, name, value: feedCategoryValue(kind, id) });
    }
    result.push(...[...categories.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  }
  return result;
}
