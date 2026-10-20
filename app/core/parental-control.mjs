import { isTitleBlocked } from './title-blocks.mjs';
const RESTRICTED_MARKERS = Object.freeze([
  '+18',
  '18+',
  'xxx',
  'adult',
  'adulto',
  'erotico',
  'erotica',
  'erotic'
]);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

export function isRestrictedLabel(value) {
  const text = normalize(value);
  return RESTRICTED_MARKERS.some(marker => text.includes(marker));
}

export function restrictedCategoryIds(categories = []) {
  return new Set((Array.isArray(categories) ? categories : [])
    .filter(category => isRestrictedLabel(category?.name || category?.id))
    .map(category => String(category?.id || ''))
    .filter(Boolean));
}

export function isRestrictedItem(item, categories = []) {
  if (!item) return false;
  // Pass a precomputed Set when scanning a large catalog. Keep array support
  // for callers checking a single title.
  const restrictedCategories = categories instanceof Set ? categories : restrictedCategoryIds(categories);
  if (restrictedCategories.has(String(item.categoryId || ''))) return true;
  return [item.name, item.categoryId, item.genre, item.plot].some(isRestrictedLabel);
}

export function filterCatalogForProfile(catalog = {}, profile = null) {
  if (!profile?.kidsMode && !profile?.blockedTitles?.length) return catalog;
  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  const restrictedIds = restrictedCategoryIds(categories);
  return {
    ...catalog,
    categories: profile?.kidsMode ? categories.filter(category => !restrictedIds.has(String(category?.id || ''))) : categories,
    items: (Array.isArray(catalog.items) ? catalog.items : []).filter(item => !isTitleBlocked(profile, item)
      && (!profile?.kidsMode || !isRestrictedItem(item, restrictedIds)))
  };
}

export function filterItemsForProfile(items = [], profile = null, categories = []) {
  if (!profile?.kidsMode && !profile?.blockedTitles?.length) return Array.isArray(items) ? items : [];
  const restrictedIds = restrictedCategoryIds(categories);
  return (Array.isArray(items) ? items : []).filter(item => !isTitleBlocked(profile, item)
    && (!profile?.kidsMode || !isRestrictedItem(item, restrictedIds)));
}
