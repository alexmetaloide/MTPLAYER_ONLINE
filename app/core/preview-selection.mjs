function normalized(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const SUBTITLED = /\b(?:legendad[oa]s?|leg|subbed|subtitled|subtitulado[sa]?)\b/;
const DUBBED = /\b(?:dublad[oa]s?|dub|pt[\s-]?br|portugues|nacional)\b/;
const EDITION = /\b(?:dublad[oa]s?|dub|dual(?:[\s-]+audio)?|multi(?:[\s-]+audio)?|pt[\s-]?br|portugues|nacional|sd|hd|fhd|full[\s-]?hd|uhd|4k|8k|720p?|1080p?|2160p?|h[.\s-]?26[45]|hevc|x26[45]|web[\s-]?dl|webrip|bluray|blu[\s-]?ray)\b/g;

export function titleIdentity(item) {
  const raw = normalized(item.name);
  const titleYear = raw.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const year = String(item.year || item.releaseDate || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || titleYear;
  const title = raw.replace(EDITION, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return { title: title || raw, year };
}

/** Provider labels are evidence of a subtitled edition; a subtitle track alone isn't. */
export function isSubtitledPreview(item, categoryName = '') {
  return [item.name, item.categoryId, item.categoryName, item.audioLabel, categoryName]
    .some(value => SUBTITLED.test(normalized(value)));
}

function previewWeight(item) {
  const text = normalized(item.name);
  if (/\b(?:8k|4320p?)\b/.test(text)) return 4320;
  if (/\b(?:4k|uhd|2160p?)\b/.test(text)) return 2160;
  if (/\b(?:fhd|full[\s-]?hd|1080p?)\b/.test(text)) return 1080;
  if (/\b(?:hd|720p?)\b/.test(text)) return 720;
  if (/\b(?:sd|360p?|480p?)\b/.test(text)) return 480;
  return 1080;
}

/** One light edition per title/year; the original item remains available for full playback. */
export function selectPreviewEditions(items, categories = [], { index } = {}) {
  const names = new Map(categories.map(category => [String(category.id), category.name]));
  const groups = new Map();
  for (const item of items || []) {
    if (!item?.id || !item?.name || isSubtitledPreview(item, names.get(String(item.categoryId)))) continue;
    const { title, year } = titleIdentity(item);
    const key = `${item.kind}:${title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, year });
  }
  const result = [];
  for (const group of groups.values()) {
    const years = new Set(group.map(entry => entry.year).filter(Boolean));
    const editions = new Map();
    for (const { item, year } of group) {
      // A missing year can match a single known release, but never merge two remakes.
      const key = year || (years.size === 1 ? [...years][0] : '');
      const current = editions.get(key);
      const dubbed = DUBBED.test(normalized([item.name, item.categoryId, item.categoryName,
        item.audioLabel, names.get(String(item.categoryId))].join(' ')));
      const rank = dubbed ? 1 : 0;
      const weight = previewWeight(item);
      if (!current || rank > current.rank || (rank === current.rank
        && (weight < current.weight || (weight === current.weight
          && (item.recentAddedAt || 0) > (current.item.recentAddedAt || 0))))) {
        editions.set(key, { item, rank, weight });
      }
    }
    if (index) for (const { item, year } of group) {
      const key = year || (years.size === 1 ? [...years][0] : '');
      index.set(`${item.kind}:${item.id}`, editions.get(key).item);
    }
    result.push(...[...editions.values()].map(entry => entry.item));
  }
  return result;
}

export function buildPreviewEditionIndex(items, categories = []) {
  const index = new Map();
  selectPreviewEditions(items, categories, { index });
  return index;
}
