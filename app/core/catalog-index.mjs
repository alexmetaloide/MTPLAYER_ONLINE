const catalogIndexes = new WeakMap();
const emptyItems = [];

// Catalog refreshes replace the item array. Weak keys let old catalogs be freed.
export function prepareCatalogIndex(items = emptyItems) {
  let cached = catalogIndexes.get(items);
  if (cached && cached.length === items.length) return cached;
  const indexedItems = items.map(item => ({
    item,
    categoryId: String(item.categoryId || ''),
    name: String(item.name || '').toLocaleLowerCase('pt-BR')
  }));
  const categoryIndex = new Map([['all', indexedItems]]);
  for (const entry of indexedItems) {
    if (!entry.categoryId) continue;
    if (!categoryIndex.has(entry.categoryId)) categoryIndex.set(entry.categoryId, []);
    categoryIndex.get(entry.categoryId).push(entry);
  }
  cached = { length: items.length, indexedItems, categoryIndex };
  catalogIndexes.set(items, cached);
  return cached;
}
