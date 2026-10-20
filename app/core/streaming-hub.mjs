import { isRestrictedItem, restrictedCategoryIds } from './parental-control.mjs';
import { selectPreviewEditions, titleIdentity } from './preview-selection.mjs';
import { parseCatalogAddedAt } from './recent.mjs';

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim();
}

function rank(item) {
  const rating = Number(String(item.rating || '').replace(',', '.'));
  return (Number.isFinite(rating) ? Math.min(10, Math.max(0, rating)) : 0) * 10
    + (item.image ? 8 : 0) + (item.backdrop ? 4 : 0);
}

// Catalog arrays are replaced on provider refresh. Retain only the latest
// prepared catalog so old accounts and large search indexes can be collected.
let preparedCatalog = null;

function prepareCatalog(catalogs) {
  const vod = catalogs?.vod || {};
  const series = catalogs?.series || {};
  if (preparedCatalog && preparedCatalog.vodItems === vod.items
      && preparedCatalog.vodCategories === vod.categories
      && preparedCatalog.seriesItems === series.items
      && preparedCatalog.seriesCategories === series.categories) return preparedCatalog;

  const all = [];
  const visible = [];
  const byId = new Map();
  for (const [kind, catalog] of [['vod', vod], ['series', series]]) {
    const categories = catalog.categories || [];
    const restrictedIds = restrictedCategoryIds(categories);
    const typed = [];
    for (const item of catalog.items || []) {
      if (!item?.id || !item?.name || isRestrictedItem(item, restrictedIds)) continue;
      const candidate = { ...item, kind };
      typed.push(candidate);
      byId.set(`${kind}:${item.id}`, candidate);
    }
    all.push(...typed);
    visible.push(...selectPreviewEditions(typed, categories));
  }
  const sorted = [...visible].sort((a, b) => rank(b) - rank(a)
    || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const dated = visible.map(item => ({ item, date: parseCatalogAddedAt(item.addedAt) }))
    .filter(entry => entry.date).sort((a, b) => b.date - a.date);
  preparedCatalog = {
    vodItems: vod.items, vodCategories: vod.categories,
    seriesItems: series.items, seriesCategories: series.categories,
    all, sorted, dated, byId, searchEntries: null
  };
  return preparedCatalog;
}

/** Deterministic, account-local collections. There is no server-wide popularity metric. */
export function buildStreamingHub(catalogs, { history = [], favorites = [], accountId = '', profileId = '', now = Date.now() } = {}) {
  const empty = { featured: null, highlights: [], newArrivals: [], watchAgain: [], myList: [], seriesPicks: [] };
  if (!accountId) return empty;
  const scope = row => String(row?.accountId || '') === String(accountId)
    && String(row?.profileId || '') === String(profileId);
  const prepared = prepareCatalog(catalogs);
  const byId = prepared.byId;
  const completed = (Array.isArray(history) ? history : []).filter(entry => scope(entry) && entry.completed && entry.item);
  const completedKeys = new Set(completed.map(entry => `${entry.item.kind}:${entry.item.seriesId || entry.item.id}`));
  const preferred = (Array.isArray(favorites) ? favorites : []).filter(row => scope(row) && ['vod', 'series'].includes(row.kind));
  const favoriteKeys = new Set(preferred.map(row => `${row.kind}:${row.id}`));
  const highlight = [];
  const seriesPicks = [];
  const movies = [];
  const series = [];
  const discoveryKeys = new Set();
  let featuredFallback = null;
  let featuredCandidates = 0;
  // Keep bounded, ranked candidates for a mixed rail and a separate series rail.
  for (const item of prepared.sorted) {
    const key = `${item.kind}:${item.id}`;
    if (completedKeys.has(key)) continue;
    // Keep the existing hero selection independent of the two rail assignments.
    if (featuredCandidates < 12) {
      if (!featuredFallback || (!(featuredFallback.image || featuredFallback.backdrop)
          && (item.image || item.backdrop))) featuredFallback = item;
      featuredCandidates += 1;
    }
    if (discoveryKeys.has(key)) continue;
    const candidates = item.kind === 'series' ? series : movies;
    if (candidates.length >= (item.kind === 'series' ? 24 : 12)) continue;
    candidates.push(item);
    discoveryKeys.add(key);
    if (movies.length === 12 && series.length === 24) break;
  }
  if (movies.length && series.length) {
    let movieIndex = 0;
    let seriesIndex = 0;
    // Alternate types even when the provider rates every series above movies.
    // If one type runs out, fill the remaining slots with the other type.
    while (highlight.length < 12 && (movieIndex < movies.length || seriesIndex < series.length)) {
      if (movieIndex < movies.length) highlight.push(movies[movieIndex++]);
      if (highlight.length < 12 && seriesIndex < series.length) highlight.push(series[seriesIndex++]);
    }
    seriesPicks.push(...series.slice(seriesIndex, seriesIndex + 12));
  } else if (movies.length) {
    highlight.push(...movies);
  } else {
    // Preserve the series-only layout without repeating titles in short catalogs.
    seriesPicks.push(...series.slice(0, 12));
    highlight.push(...series.slice(12, 24));
  }
  const newArrivals = [];
  for (const entry of prepared.dated) {
    if (entry.date > now + 86400000) continue;
    if (now - entry.date > 60 * 86400000) break;
    newArrivals.push(entry.item);
    if (newArrivals.length === 12) break;
  }
  const watchAgain = [];
  const replaySeen = new Set();
  for (const entry of completed.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const source = entry.item;
    const seriesId = source.kind === 'series' && source.seriesId ? String(source.seriesId) : '';
    const key = `${source.kind}:${seriesId || source.id}`;
    if (replaySeen.has(key)) continue;
    replaySeen.add(key);
    const movieOrSeries = byId.get(key);
    if (movieOrSeries) watchAgain.push(movieOrSeries);
    if (watchAgain.length >= 12) break;
  }
  const myList = [];
  for (const favorite of preferred.slice().reverse()) {
    const item = byId.get(`${favorite.kind}:${favorite.id}`);
    if (item && !myList.some(row => row.kind === item.kind && String(row.id) === String(item.id))) myList.push(item);
    if (myList.length >= 12) break;
  }
  const featured = newArrivals.find(item => item.image || item.backdrop) || featuredFallback;
  return {
    featured: featured ? { ...featured, inMyList: favoriteKeys.has(`${featured.kind}:${featured.id}`) } : null,
    highlights: highlight,
    newArrivals,
    watchAgain,
    myList,
    seriesPicks
  };
}

/** Search both movie and series catalogs, accent-insensitively and without network calls. */
export function searchStreamingCatalog(catalogs, term = '', { kind = 'all', limit = 80 } = {}) {
  const query = normalizeSearch(term);
  const words = query.split(/\s+/).filter(Boolean);
  const prepared = prepareCatalog(catalogs);
  if (!prepared.searchEntries) {
    // Preserve every available edition, including subtitled-only titles.
    // Precompute normalized search text and sort once per catalog refresh.
    prepared.searchEntries = prepared.all.map(item => ({
      item, haystack: normalizeSearch([item.name, item.genre, item.year].filter(Boolean).join(' '))
    })).sort((a, b) => rank(b.item) - rank(a.item)
      || String(a.item.name).localeCompare(String(b.item.name), 'pt-BR'));
  }
  const max = Math.max(0, limit);
  const items = [];
  let total = 0;
  for (const entry of prepared.searchEntries) {
    if (kind !== 'all' && entry.item.kind !== kind) continue;
    if (words.length && !words.every(word => entry.haystack.includes(word))) continue;
    if (total < max) items.push(entry.item);
    total += 1;
  }
  return { items, total };
}

/** Related titles use the prepared catalog, with no extra metadata requests. */
export function similarTitles(catalogs, source, { ratings = [], limit = 8 } = {}) {
  if (!source || !['vod', 'series'].includes(source.kind)) return [];
  const prepared = prepareCatalog(catalogs);
  const genres = value => normalizeSearch(value).split(/[,;/|]+/).map(part => part.trim()).filter(Boolean);
  if (!prepared.relatedBuckets) {
    prepared.relatedBuckets = new Map();
    for (const item of prepared.sorted) {
      const tags = [...new Set([item.categoryId && `category:${item.categoryId}`, ...genres(item.genre).map(tag => `genre:${tag}`)].filter(Boolean))];
      for (const tag of tags) {
        const key = `${item.kind}:${tag}`;
        if (!prepared.relatedBuckets.has(key)) prepared.relatedBuckets.set(key, []);
        prepared.relatedBuckets.get(key).push(item);
      }
    }
  }
  const catalogItem = prepared.byId.get(`${source.kind}:${source.id}`);
  const item = { ...catalogItem, ...source };
  const tags = [...new Set([item.categoryId && `category:${item.categoryId}`, ...genres(item.genre).map(tag => `genre:${tag}`)].filter(Boolean))];
  const scored = new Map();
  for (const tag of tags) for (const candidate of prepared.relatedBuckets.get(`${source.kind}:${tag}`) || []) {
    const current = scored.get(String(candidate.id)) || { item: candidate, score: 0 };
    current.score += tag.startsWith('genre:') ? 5 : 3;
    scored.set(String(candidate.id), current);
  }
  const identity = titleIdentity(item);
  const rejected = new Set(ratings.filter(row => row.value === -1 && row.kind === source.kind).map(row => String(row.id)));
  return [...scored.values()].filter(row => {
    if (String(row.item.id) === String(source.id) || rejected.has(String(row.item.id))) return false;
    const other = titleIdentity(row.item);
    return other.title !== identity.title || (other.year && identity.year && other.year !== identity.year);
  }).sort((a, b) => b.score - a.score || rank(b.item) - rank(a.item)
    || String(a.item.name).localeCompare(String(b.item.name), 'pt-BR'))
    .slice(0, Math.max(0, Math.min(12, Number(limit) || 0))).map(row => row.item);
}
