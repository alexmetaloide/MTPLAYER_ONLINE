export function queryMyList(items, { kind = 'all', status = 'all', sort = 'recent', term = '', history = [], accountId = '', profileId = '' } = {}) {
  const started = new Set();
  for (const entry of history) {
    if (String(entry.accountId) !== String(accountId) || String(entry.profileId || '') !== String(profileId)
        || (!entry.completed && !(entry.position > 0))) continue;
    started.add(`${entry.item?.kind}:${entry.item?.seriesId || entry.item?.id}`);
  }
  const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const query = normalize(term).trim();
  const seen = new Set();
  const rows = [];
  for (const [index, item] of (items || []).entries()) {
    const key = `${item.kind}:${item.id || item.sourceId || item.name}`;
    if (seen.has(key) || (kind !== 'all' && item.kind !== kind)) continue;
    if (query && !normalize(item.name).includes(query)) continue;
    const wasStarted = started.has(`${item.kind}:${item.id}`);
    if (status === 'started' && !wasStarted) continue;
    if (status === 'not-started' && (wasStarted || !['vod', 'series'].includes(item.kind))) continue;
    seen.add(key);
    rows.push({ item, index });
  }
  const nameOrder = (a, b) => String(a.item.name).localeCompare(String(b.item.name), 'pt-BR');
  const year = item => Number(String(item.year || item.releaseDate || '').match(/\b(?:19|20)\d{2}\b/)?.[0]) || 0;
  rows.sort(sort === 'name' ? nameOrder : sort === 'release' ? (a, b) => year(b.item) - year(a.item) || nameOrder(a, b)
    : (a, b) => (Number(b.item.savedAt) || 0) - (Number(a.item.savedAt) || 0) || b.index - a.index);
  return rows.map(row => row.item);
}
