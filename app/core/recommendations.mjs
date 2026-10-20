import { isRestrictedItem, restrictedCategoryIds } from './parental-control.mjs';
import { selectPreviewEditions } from './preview-selection.mjs';
import { sanitizeRatings } from './ratings.mjs';

const GENERIC_TAGS = new Set([
  'filme', 'filmes', 'serie', 'series', 'temporada', 'episodio', 'vod', 'iptv',
  'dublado', 'legendado', 'dual', 'audio', 'hd', 'fhd', 'full', 'uhd', '4k',
  'lancamentos', 'lancamento', 'novidades', 'novo', 'novos', 'nacional',
  'internacional', 'netflix', 'prime', 'disney', 'max', 'hbo', '2024', '2025', '2026',
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e', 'the', 'and'
]);
const EDITION_MARKERS = /\b(?:4k|8k|uhd|fhd|hd|full hd|720p|1080p|2160p|dublado|legendado|dual audio|pt br|bluray|web dl)\b/g;

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

function genreTags(value) {
  return [...new Set(normalize(value).split(/[^a-z0-9]+/g)
    .filter(part => part.length > 2 && !GENERIC_TAGS.has(part) && !/^\d+$/.test(part)))];
}

function movieIdentity(item) {
  const name = normalize(item.name);
  const year = String(item.year || name.match(/\b(?:19|20)\d{2}\b/)?.[0] || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const title = name.replace(EDITION_MARKERS, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return { title, year };
}

function distinctCandidates(items, categories, kind) {
  const chosen = selectPreviewEditions(items, categories);
  // Subtitled-only titles still belong in recommendations even though the
  // preview feed normally skips them when choosing autoplay editions.
  const seen = new Set(chosen.map(item => `${movieIdentity(item).title}:${movieIdentity(item).year}`));
  for (const item of items) {
    const { title, year } = movieIdentity(item);
    const key = `${title}:${year}`;
    if (!title || seen.has(key)) continue;
    chosen.push({ ...item, kind });
    seen.add(key);
  }
  return chosen;
}

function validWatch(entry) {
  if (entry?.completed) return true;
  const position = Number(entry?.position) || 0;
  const duration = Number(entry?.duration) || 0;
  return position >= 120 && (!duration || position / duration >= 0.1);
}

function safeRating(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 10)) : 0;
}

/** Recommend only content available in the current account's local catalog.
 * All signals are scoped to the active profile. No account data is sent out.
 */
export function buildRecommendations(catalogs, {
  history = [], favorites = [], accountId = '', profileId = '', limitPerKind = 8,
  now = Date.now(), ratings = []
} = {}) {
  const empty = { vod: [], series: [], watchedCount: 0 };
  if (!accountId) return empty;
  const belongsToProfile = entry => String(entry?.accountId || '') === String(accountId)
    && String(entry?.profileId || '') === String(profileId);
  const watches = (Array.isArray(history) ? history : []).filter(entry => belongsToProfile(entry)
    && ['vod', 'series'].includes(entry?.item?.kind) && validWatch(entry));
  const userRatings = sanitizeRatings(ratings);
  const positiveRatings = userRatings.filter(row => row.value > 0);
  if (!watches.length && !positiveRatings.length) return empty;

  const activeFavorites = (Array.isArray(favorites) ? favorites : []).filter(belongsToProfile);
  const catalogByKind = {};
  const categoriesByKind = {};
  for (const kind of ['vod', 'series']) {
    const catalog = catalogs?.[kind] || {};
    const items = Array.isArray(catalog.items) ? catalog.items : [];
    catalogByKind[kind] = new Map(items.map(item => [String(item.id), item]));
    categoriesByKind[kind] = new Map((catalog.categories || [])
      .map(category => [String(category.id), String(category.name || '')]));
  }

  const watchedKeys = new Set();
  const watchedMovies = new Map();
  const watchedSeriesIds = new Set();
  const affinities = new Map();
  const seeds = [];
  const addAffinity = (key, weight) => affinities.set(key, (affinities.get(key) || 0) + weight);

  function addSignal(item, kind, weight, label = '') {
    const categoryId = String(item.categoryId || '');
    if (categoryId) addAffinity(`${kind}:category:${categoryId}`, weight);
    const categoryName = categoriesByKind[kind]?.get(categoryId) || categoryId;
    const tags = new Set([...genreTags(categoryName), ...genreTags(item.genre)]);
    for (const tag of tags) addAffinity(`tag:${tag}`, weight / Math.sqrt(tags.size || 1));
    if (label && seeds.length < 16) seeds.push({ kind, label, categoryId, tags });
  }

  for (const row of positiveRatings) {
    const source = catalogByKind[row.kind].get(row.id);
    if (source && !isRestrictedItem(source, restrictedCategoryIds(catalogs?.[row.kind]?.categories || []))) {
      addSignal(source, row.kind, row.value === 2 ? 3 : 1.8, source.name);
    }
  }
  const rejected = new Set(userRatings.filter(row => row.value < 0).map(row => `${row.kind}:${row.id}`));
  const ratedSeedLabels = new Set(positiveRatings.map(row => `${row.kind}:${catalogByKind[row.kind].get(row.id)?.name || ''}`));

  for (const entry of watches) {
    const item = entry.item;
    const kind = item.kind;
    watchedKeys.add(`${kind}:${item.id}`);
    if (kind === 'vod') {
      const { title, year } = movieIdentity(item);
      if (title) {
        if (!watchedMovies.has(title)) watchedMovies.set(title, new Set());
        watchedMovies.get(title).add(year);
      }
    }
    if (kind === 'series' && item.seriesId) watchedSeriesIds.add(String(item.seriesId));
    const related = kind === 'series' && item.seriesId
      ? catalogByKind.series.get(String(item.seriesId)) : catalogByKind[kind].get(String(item.id));
    const source = { ...item, ...related };
    const ageDays = Math.max(0, (now - (Number(entry.updatedAt) || now)) / 86400000);
    const weight = (entry.completed ? 1.35 : 1) * (0.55 + 0.45 * Math.exp(-ageDays / 90));
    addSignal(source, kind, weight, String(item.seriesName || related?.name || item.name || ''));
  }

  // Favorites refine the model without substituting for actual watch history.
  for (const favorite of activeFavorites) {
    const kind = favorite.kind;
    if (!['vod', 'series'].includes(kind)) continue;
    const source = { ...favorite, ...catalogByKind[kind].get(String(favorite.id)) };
    addSignal(source, kind, 0.3);
  }

  const favoriteKeys = new Set(activeFavorites.map(item => `${item.kind}:${item.id}`));
  const maximum = Math.max(0, Math.min(20, Math.floor(Number(limitPerKind) || 0)));
  const result = { vod: [], series: [], watchedCount: watches.length, ratedCount: positiveRatings.length };
  for (const kind of ['vod', 'series']) {
    const catalog = catalogs?.[kind] || {};
    const categories = catalog.categories || [];
    const restrictedIds = restrictedCategoryIds(categories);
    const safeItems = (Array.isArray(catalog.items) ? catalog.items : []).filter(item =>
      item?.id && item?.name && !isRestrictedItem(item, restrictedIds));
    const candidates = distinctCandidates(safeItems.map(item => ({ ...item, kind })), categories, kind);
    const scored = [];
    for (const item of candidates) {
      const key = `${kind}:${item.id}`;
      if (rejected.has(key)) continue;
      if (watchedKeys.has(key) || (kind === 'series' && watchedSeriesIds.has(String(item.id)))) continue;
      if (kind === 'vod') {
        const { title, year } = movieIdentity(item);
        const watchedYears = watchedMovies.get(title);
        if (watchedYears && (!year || watchedYears.has(year) || watchedYears.has(''))) continue;
      }
      const categoryId = String(item.categoryId || '');
      const categoryName = categoriesByKind[kind].get(categoryId) || categoryId;
      const categoryScore = affinities.get(`${kind}:category:${categoryId}`) || 0;
      const tags = new Set([...genreTags(categoryName), ...genreTags(item.genre)]);
      let tagScore = 0;
      for (const tag of tags) tagScore += affinities.get(`tag:${tag}`) || 0;
      const match = seeds.find(seed => (seed.kind === kind && categoryId && seed.categoryId === categoryId)
        || [...tags].some(tag => seed.tags.has(tag)));
      const ratedSeed = match && ratedSeedLabels.has(`${match.kind}:${match.label}`);
      const reason = match ? `Porque você ${ratedSeed ? 'gostou de' : 'assistiu'} ${match.label}` : 'Explore algo novo';
      const rank = categoryScore * 42 + Math.min(7, tagScore) * 25
        + safeRating(item.rating) * 1.5 + (item.image ? 3 : 0)
        + (favoriteKeys.has(key) ? 9 : 0);
      scored.push({ ...item, recommendationScore: rank, recommendationReason: reason });
    }
    scored.sort((a, b) => b.recommendationScore - a.recommendationScore
      || safeRating(b.rating) - safeRating(a.rating)
      || String(a.name).localeCompare(String(b.name), 'pt-BR'));
    result[kind] = scored.slice(0, maximum);
  }
  return result;
}
