// Stable catalog identity only; this is not a cryptographic/security hash.
function sourceIdentity(text) {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `web-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function parseAttributes(line) {
  const attrs = {};
  line.replace(/([\w-]+)="([^"]*)"/g, (_m, key, value) => { attrs[key] = value; return ''; });
  return attrs;
}

function classifyM3uItem(meta, url) {
  const haystack = `${meta.group || ''} ${meta.name || ''} ${url || ''}`.toLowerCase();
  if (/\b(radio|rádio)\b/.test(haystack)) return 'radio';
  if (/\b(series|serie|séries|temporada|season)\b/.test(haystack)) return 'series';
  if (/\b(vod|movie|movies|filme|filmes|cinema)\b/.test(haystack)) return 'vod';
  return 'live';
}

function parseM3u(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('A playlist não possui cabeçalho #EXTM3U válido.');
  const headerAttrs = parseAttributes(lines[0]);
  const catalogs = {
    live: { categories: [], items: [] },
    vod: { categories: [], items: [] },
    series: { categories: [], items: [] },
    radio: { categories: [], items: [] }
  };
  const sources = Object.create(null);
  const groups = { live: new Set(), vod: new Set(), series: new Set(), radio: new Set() };
  let meta = null;

  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXTINF:')) {
      const attrs = parseAttributes(line);
      const comma = line.lastIndexOf(',');
      meta = {
        name: comma >= 0 ? line.slice(comma + 1).trim() : attrs['tvg-name'] || 'Canal',
        image: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'Outros',
        tvgId: attrs['tvg-id'] || '',
        addedAt: attrs['date-added'] || attrs['date_added'] || attrs.added || attrs['tvg-added'] || '',
        catchup: attrs.catchup || '',
        catchupSource: attrs['catchup-source'] || '',
        catchupDays: Math.max(0, Number(attrs['catchup-days']) || 0),
        headers: {}
      };
      continue;
    }
    if (meta && line.startsWith('#EXTVLCOPT:')) {
      const option = line.slice('#EXTVLCOPT:'.length);
      const split = option.indexOf('=');
      const key = split >= 0 ? option.slice(0, split).toLowerCase() : option.toLowerCase();
      const value = split >= 0 ? option.slice(split + 1) : '';
      if (key === 'http-user-agent') meta.headers['User-Agent'] = value;
      if (key === 'http-referrer' || key === 'http-referer') meta.headers.Referer = value;
      continue;
    }
    if (meta && line.startsWith('#EXTGRP:')) {
      meta.group = line.slice('#EXTGRP:'.length).trim() || meta.group;
      continue;
    }
    if (meta && !line.startsWith('#')) {
      const kind = classifyM3uItem(meta, line);
      const sourceId = sourceIdentity(`${kind}|${meta.tvgId}|${meta.name}|${line}`);
      const item = {
        kind,
        id: sourceId,
        sourceId,
        name: meta.name,
        image: meta.image,
        categoryId: meta.group,
        tvgId: meta.tvgId,
        addedAt: meta.addedAt,
        catchup: meta.catchup || (meta.catchupSource ? 'default' : ''),
        catchupDays: meta.catchupDays,
        containerExtension: (() => {
          try { return new URL(line).pathname.split('.').pop()?.toLowerCase() || ''; } catch { return ''; }
        })()
      };
      catalogs[kind].items.push(item);
      groups[kind].add(meta.group);
      sources[sourceId] = { url: line, headers: meta.headers, catchupSource: meta.catchupSource, catchup: meta.catchup, catchupDays: meta.catchupDays };
      meta = null;
    }
  }

  for (const kind of Object.keys(catalogs)) {
    catalogs[kind].categories = [...groups[kind]].map(name => ({ id: name, name }));
  }
  return {
    catalogs,
    sources,
    epgUrl: headerAttrs['x-tvg-url'] || headerAttrs['url-tvg'] || ''
  };
}

function createM3uProvider(http, logger) {
  async function authenticate(account) {
    const text = await http.getText(account.url, { maxBytes: 50 * 1024 * 1024, timeoutMs: 30000 });
    const parsed = parseM3u(text);
    return { status: 'Active', parsed };
  }

  async function load(account) {
    const text = await http.getText(account.url, { maxBytes: 50 * 1024 * 1024, timeoutMs: 45000 });
    const parsed = parseM3u(text);
    logger?.info('Playlist M3U carregada.', {
      live: parsed.catalogs.live.items.length,
      vod: parsed.catalogs.vod.items.length,
      series: parsed.catalogs.series.items.length,
      radio: parsed.catalogs.radio.items.length
    });
    return parsed;
  }

  return { authenticate, load, parseM3u };
}

export { createM3uProvider, parseM3u, classifyM3uItem, parseAttributes };
