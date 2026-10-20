(() => {
  const isTizen = Boolean(globalThis.tizen || globalThis.webapis?.avplay);
  if (!isTizen || globalThis.desktopAPI) return;

  // Samsung TVs based on older Chromium/WebKit engines (including AU7700)
  // do not expose Element.replaceChildren(), which the shared renderer uses
  // extensively to swap views. Install a small platform-only compatibility
  // shim before app.mjs is evaluated.
  if (globalThis.Element && !Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function (...nodes) {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (const node of nodes) {
        this.appendChild(node instanceof Node ? node : document.createTextNode(String(node)));
      }
    };
  }

  document.documentElement.classList.add('tizen-tv');
  const tvStyles = document.getElementById('tizen-tv-styles');
  if (tvStyles) tvStyles.media = 'all';

  const ACCOUNTS_KEY = 'metalloide:tizen:accounts:v1';
  const SUMMARY_KEY = 'metalloide:tizen:summary:v1';
  const BACKUP_KEY = 'metalloide:tizen:last-backup:v1';
  const DB_NAME = 'metalloide-iptv-tizen';
  const DB_VERSION = 1;
  const STORE = 'cache';
  const memoryCache = new Map();
  const MEMORY_CACHE_LIMIT = 28;
  const M3U_EPG_TTL_MS = 2 * 60 * 60 * 1000;
  let databasePromise = null;

  function memoryCacheRemember(key, value) {
    if (memoryCache.has(key)) memoryCache.delete(key);
    memoryCache.set(key, value);
    while (memoryCache.size > MEMORY_CACHE_LIMIT) memoryCache.delete(memoryCache.keys().next().value);
    return value;
  }

  function memoryCacheRead(key) {
    if (!memoryCache.has(key)) return null;
    const value = memoryCache.get(key);
    memoryCache.delete(key);
    memoryCache.set(key, value);
    return value;
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `tv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function openDb() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(resolve => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        databasePromise = null;
        resolve(null);
      };
    });
    return databasePromise;
  }

  async function cacheGet(key) {
    if (memoryCache.has(key)) return memoryCacheRead(key);
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result ?? null;
        if (value != null) memoryCacheRemember(key, value);
        resolve(value);
      };
      request.onerror = () => resolve(null);
    });
  }

  async function cacheSet(key, value) {
    memoryCacheRemember(key, value);
    const db = await openDb();
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  }

  async function cacheDeletePrefix(prefix) {
    for (const key of [...memoryCache.keys()]) if (key.startsWith(prefix)) memoryCache.delete(key);
    const db = await openDb();
    if (!db) return;
    await new Promise(resolve => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  }

  function request(url, { timeoutMs = 35000, responseType = 'text' } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;
      xhr.responseType = responseType;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error(`Servidor respondeu HTTP ${xhr.status}.`));
      };
      xhr.onerror = () => reject(new Error('Não foi possível conectar ao servidor IPTV.'));
      xhr.ontimeout = () => reject(new Error('O servidor IPTV demorou demais para responder.'));
      xhr.send();
    });
  }

  async function getJson(url, options) {
    const text = await request(url, options);
    try { return JSON.parse(text); }
    catch { throw new Error('O servidor retornou uma resposta inválida.'); }
  }

  function normalizeServer(server) {
    let value = String(server || '').trim();
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Apenas endereços HTTP ou HTTPS são aceitos.');
    let path = url.pathname || '';
    const lower = path.toLowerCase();
    const markers = ['/player_api.php', '/panel_api.php', '/get.php', '/xmltv.php'];
    const positions = markers.map(marker => lower.indexOf(marker)).filter(index => index >= 0);
    if (positions.length) path = path.slice(0, Math.min(...positions));
    path = path.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
  }

  function apiUrl(account, action, extra = {}, endpoint = account.apiEndpoint || 'player_api.php') {
    const file = endpoint === 'panel_api.php' ? 'panel_api.php' : 'player_api.php';
    const url = new URL(`${normalizeServer(account.server)}/${file}`);
    url.searchParams.set('username', account.username);
    url.searchParams.set('password', account.password);
    if (action) url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return url.toString();
  }

  function authAccepted(user) {
    if (!user || typeof user !== 'object') return false;
    const auth = String(user.auth ?? '').trim().toLowerCase();
    if (auth === '1' || auth === 'true') return true;
    if (auth) return false;
    const status = String(user.status ?? '').trim().toLowerCase();
    return ['active', 'enabled'].includes(status) && (user.username != null || user.exp_date != null || user.max_connections != null);
  }

  function allowedFormats(user) {
    if (Array.isArray(user?.allowed_output_formats)) return user.allowed_output_formats.map(String);
    return String(user?.allowed_output_formats || '').split(/[,;\s]+/).map(value => value.trim()).filter(Boolean);
  }

  async function authenticateXtream(account) {
    const endpoints = account.apiEndpoint === 'panel_api.php' ? ['panel_api.php', 'player_api.php'] : ['player_api.php', 'panel_api.php'];
    let rejected = false;
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const data = await getJson(apiUrl(account, null, {}, endpoint));
        const user = data?.user_info && typeof data.user_info === 'object' ? data.user_info : data;
        if (!authAccepted(user)) {
          if (user && typeof user === 'object') rejected = true;
          continue;
        }
        const expires = Number(user.exp_date || 0);
        return {
          status: user.status || 'Active',
          expiresAt: expires > 0 ? new Date(expires * 1000).toISOString() : null,
          activeConnections: user.active_cons == null ? null : Number(user.active_cons),
          maxConnections: user.max_connections == null ? null : Number(user.max_connections),
          allowedOutputFormats: allowedFormats(user),
          apiEndpoint: endpoint,
          serverTimezone: String(data?.server_info?.timezone || '')
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (rejected) throw new Error('Usuário ou senha recusados pelo servidor.');
    throw new Error(`Não foi possível conectar à API Xtream. ${lastError?.message || 'Servidor indisponível.'}`);
  }

  function normalizeCategory(raw) {
    return { id: String(raw?.category_id ?? raw?.id ?? ''), name: String(raw?.category_name ?? raw?.name ?? 'Categoria') };
  }

  function normalizeItem(kind, raw) {
    const id = raw?.stream_id ?? raw?.series_id ?? raw?.id;
    const backdrop = Array.isArray(raw?.backdrop_path) ? raw.backdrop_path.find(Boolean) : (raw?.backdrop_path ?? raw?.backdrop ?? '');
    return {
      kind,
      id: id == null ? '' : String(id),
      name: String(raw?.name ?? raw?.title ?? 'Sem nome'),
      image: String(raw?.stream_icon ?? raw?.cover ?? raw?.cover_big ?? ''),
      categoryId: String(raw?.category_id ?? raw?.category ?? ''),
      rating: raw?.rating == null ? '' : String(raw.rating),
      year: raw?.year == null ? '' : String(raw.year),
      containerExtension: String(raw?.container_extension ?? ''),
      plot: String(raw?.plot ?? ''),
      releaseDate: String(raw?.releaseDate ?? raw?.release_date ?? ''),
      genre: String(raw?.genre ?? ''),
      cast: String(raw?.cast ?? raw?.actors ?? ''),
      director: String(raw?.director ?? ''),
      backdrop: String(backdrop || ''),
      tvArchive: Boolean(Number(raw?.tv_archive || 0)),
      tvArchiveDuration: Math.max(0, Number(raw?.tv_archive_duration) || 0)
    };
  }

  async function getXtreamCatalog(account, kind) {
    const actions = {
      live: ['get_live_categories', 'get_live_streams'],
      vod: ['get_vod_categories', 'get_vod_streams'],
      series: ['get_series_categories', 'get_series']
    };
    if (!actions[kind]) return { categories: [], items: [] };
    const [categoryAction, itemAction] = actions[kind];
    const [categories, items] = await Promise.all([getJson(apiUrl(account, categoryAction)), getJson(apiUrl(account, itemAction))]);
    return {
      categories: Array.isArray(categories) ? categories.map(normalizeCategory) : [],
      items: Array.isArray(items) ? items.map(row => normalizeItem(kind, row)) : []
    };
  }

  function decodeBase64Text(value) {
    if (!value) return '';
    try {
      const binary = atob(String(value));
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return globalThis.TextDecoder ? new TextDecoder('utf-8').decode(bytes) : binary;
    } catch {
      return String(value);
    }
  }

  async function getShortEpg(account, streamId) {
    const data = await getJson(apiUrl(account, 'get_short_epg', { stream_id: streamId, limit: 2 }));
    return (Array.isArray(data?.epg_listings) ? data.epg_listings : []).map(row => ({
      title: decodeBase64Text(row.title),
      description: decodeBase64Text(row.description),
      start: row.start_timestamp ? Number(row.start_timestamp) * 1000 : null,
      end: row.stop_timestamp ? Number(row.stop_timestamp) * 1000 : null
    }));
  }

  async function getArchiveEpg(account, streamId, limit = 96) {
    let data = null;
    try {
      data = await getJson(apiUrl(account, 'get_simple_data_table', { stream_id: streamId }));
    } catch {}
    if (!Array.isArray(data?.epg_listings)) {
      data = await getJson(apiUrl(account, 'get_short_epg', {
        stream_id: streamId,
        limit: Math.min(Math.max(Number(limit) || 96, 2), 200)
      }));
    }
    const now = Date.now();
    return (Array.isArray(data?.epg_listings) ? data.epg_listings : [])
      .map(row => ({
        title: decodeBase64Text(row.title),
        description: decodeBase64Text(row.description),
        start: row.start_timestamp ? Number(row.start_timestamp) * 1000 : null,
        end: row.stop_timestamp ? Number(row.stop_timestamp) * 1000 : null
      }))
      .filter(row => row.start && row.end && row.end <= now)
      .sort((a, b) => b.start - a.start)
      .slice(0, Math.min(Math.max(Number(limit) || 96, 1), 200));
  }

  function decodeXmlEntities(value) {
    return String(value || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
  }

  function cleanXmlText(value) {
    const text = String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return decodeXmlEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function xmlAttr(attrs, name) {
    const match = String(attrs || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match ? decodeXmlEntities(match[1]).trim() : '';
  }

  function parseXmltvTime(raw) {
    const match = String(raw || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s+([+-])(\d{2})(\d{2}))?/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second = '00', sign, offsetHour = '00', offsetMinute = '00'] = match;
    let value = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (sign) {
      const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60 * 1000;
      value -= sign === '+' ? offset : -offset;
    }
    return Number.isFinite(value) ? value : null;
  }

  function xmlFirstTag(body, tag) {
    const match = String(body || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? cleanXmlText(match[1]) : '';
  }

  function parseM3uXmltv(input) {
    const now = Date.now();
    const lowerBound = now - 7 * 24 * 60 * 60 * 1000;
    const upperBound = now + 30 * 60 * 60 * 1000;
    const byChannel = {};
    const text = String(input || '');
    const expression = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
    let count = 0;
    let match;
    while ((match = expression.exec(text)) && count < 120000) {
      const channel = xmlAttr(match[1], 'channel');
      const start = parseXmltvTime(xmlAttr(match[1], 'start'));
      const end = parseXmltvTime(xmlAttr(match[1], 'stop'));
      if (!channel || !start || !end || end < lowerBound || start > upperBound) continue;
      (byChannel[channel] ||= []).push({
        title: xmlFirstTag(match[2], 'title') || 'Programação',
        description: xmlFirstTag(match[2], 'desc'),
        start,
        end
      });
      count += 1;
    }
    const lowerIndex = {};
    for (const [channel, rows] of Object.entries(byChannel)) {
      rows.sort((a, b) => a.start - b.start);
      lowerIndex[String(channel).toLocaleLowerCase()] = channel;
    }
    return { byChannel, lowerIndex, count };
  }

  function selectNowNext(rows, now = Date.now()) {
    const list = Array.isArray(rows) ? rows : [];
    const currentIndex = list.findIndex(row => row.start <= now && row.end > now);
    const current = currentIndex >= 0 ? list[currentIndex] : null;
    const next = list.find(row => row.start > (current?.start ?? now)) || null;
    return { now: current, next };
  }

  function m3uGuideRows(guide, ref) {
    const channels = guide?.byChannel || {};
    const lowerIndex = guide?.lowerIndex || {};
    const candidates = [ref?.tvgId, ref?.name].filter(Boolean);
    for (const candidate of candidates) {
      if (channels[candidate]) return channels[candidate];
      const normalized = String(candidate).toLocaleLowerCase();
      const key = lowerIndex[normalized];
      if (key) return channels[key] || [];
    }
    return [];
  }

  async function ensureM3uGuide(account) {
    const meta = await cacheGet(cacheKey(account.id, 'm3u-meta'));
    const epgUrl = String(meta?.epgUrl || '').trim();
    if (!epgUrl) return null;
    const key = cacheKey(account.id, 'xmltv-guide');
    const cached = await cacheGet(key);
    if (cached?.epgUrl === epgUrl && cached?.updatedAt && Date.now() - cached.updatedAt < M3U_EPG_TTL_MS) return cached;
    const xml = await request(epgUrl, { timeoutMs: 60000 });
    const parsed = parseM3uXmltv(xml);
    const guide = { epgUrl, updatedAt: Date.now(), byChannel: parsed.byChannel, lowerIndex: parsed.lowerIndex };
    await cacheSet(key, guide);
    return guide;
  }

  function parseM3u(text) {
    const categories = new Map();
    const catalogs = Object.fromEntries(['live', 'vod', 'series', 'radio'].map(kind => [kind, { categories: [], items: [] }]));
    const sources = {};
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const headerAttrs = {};
    const headerLine = lines.find(line => line.trim().startsWith('#EXTM3U')) || '';
    for (const match of headerLine.matchAll(/([\w-]+)="([^"]*)"/g)) headerAttrs[match[1].toLowerCase()] = match[2];
    let pending = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        const attrs = {};
        for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1].toLowerCase()] = match[2];
        const comma = line.indexOf(',');
        pending = { attrs, name: comma >= 0 ? line.slice(comma + 1).trim() : 'Sem nome' };
        continue;
      }
      if (line.startsWith('#') || !pending) continue;
      const group = pending.attrs['group-title'] || 'Outros';
      const lower = `${group} ${line}`.toLowerCase();
      const isRadio = /radio|rádio/.test(lower) || pending.attrs['radio'] === 'true';
      const isSeries = /\/series\//.test(lower) || /series|séries/.test(group.toLowerCase());
      const isVod = !isSeries && (/\/movie\//.test(lower) || /filmes|movies|vod/.test(group.toLowerCase()) || /\.(mp4|mkv|avi|mov)(?:\?|$)/i.test(line));
      const kind = isRadio ? 'radio' : isSeries ? 'series' : isVod ? 'vod' : 'live';
      const categoryId = `${kind}:${group}`;
      if (!categories.has(categoryId)) {
        categories.set(categoryId, true);
        catalogs[kind].categories.push({ id: categoryId, name: group });
      }
      const id = `m3u-${Object.keys(sources).length + 1}`;
      const path = (() => { try { return new URL(line).pathname; } catch { return ''; } })();
      const ext = path.split('.').pop()?.toLowerCase() || '';
      catalogs[kind].items.push({
        kind,
        id,
        sourceId: id,
        name: pending.name,
        image: pending.attrs['tvg-logo'] || '',
        tvgId: pending.attrs['tvg-id'] || '',
        categoryId,
        catchup: pending.attrs.catchup || (pending.attrs['catchup-source'] ? 'default' : ''),
        catchupAvailable: Boolean(pending.attrs['catchup-source']),
        catchupDays: Math.max(0, Number(pending.attrs['catchup-days']) || 0),
        containerExtension: ext
      });
      sources[id] = {
        url: line,
        headers: {},
        catchupSource: pending.attrs['catchup-source'] || '',
        catchup: pending.attrs.catchup || '',
        catchupDays: Math.max(0, Number(pending.attrs['catchup-days']) || 0)
      };
      pending = null;
    }
    return { catalogs, sources, epgUrl: headerAttrs['x-tvg-url'] || headerAttrs['url-tvg'] || '' };
  }

  function loadAccountsData() {
    const value = readJson(ACCOUNTS_KEY, null);
    return value?.version === 1 && Array.isArray(value.accounts) ? value : { version: 1, activeId: null, accounts: [] };
  }

  function saveAccountsData(data) {
    writeJson(ACCOUNTS_KEY, data);
  }

  function publicAccount(account) {
    if (!account) return null;
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      server: account.type === 'xtream' ? account.server : undefined,
      status: account.status || 'configured',
      expiresAt: account.expiresAt || null,
      maxConnections: account.maxConnections ?? null,
      activeConnections: account.activeConnections ?? null,
      allowedOutputFormats: Array.isArray(account.allowedOutputFormats) ? account.allowedOutputFormats : [],
      updatedAt: account.updatedAt || null
    };
  }

  function activePrivate() {
    const data = loadAccountsData();
    return data.accounts.find(account => account.id === data.activeId) || null;
  }

  function cacheKey(accountId, name) {
    return `${accountId}:${name}`;
  }

  function updateSummary(accountId, kind, count) {
    const all = readJson(SUMMARY_KEY, {});
    all[accountId] = { ...(all[accountId] || {}), [kind]: count };
    writeJson(SUMMARY_KEY, all);
  }

  async function saveAccount(draft = {}) {
    const type = draft.type === 'm3u' ? 'm3u' : 'xtream';
    const account = {
      id: draft.id || uuid(),
      type,
      name: String(draft.name || 'Minha lista').trim().slice(0, 120) || 'Minha lista',
      updatedAt: new Date().toISOString()
    };
    if (type === 'xtream') {
      account.server = normalizeServer(draft.server);
      account.username = String(draft.username || '').trim();
      account.password = String(draft.password || '');
      if (!account.server || !account.username || !account.password) throw new Error('Preencha servidor, usuário e senha.');
      Object.assign(account, await authenticateXtream(account));
    } else {
      account.url = String(draft.url || '').trim();
      if (!/^https?:\/\//i.test(account.url)) throw new Error('Informe uma URL M3U HTTP ou HTTPS válida.');
      const parsed = parseM3u(await request(account.url, { timeoutMs: 60000 }));
      if (!Object.values(parsed.catalogs).some(value => value.items.length)) throw new Error('A playlist M3U não contém itens reconhecíveis.');
      account.status = 'Active';
      await cacheSet(cacheKey(account.id, 'm3u-sources'), parsed.sources);
      await cacheSet(cacheKey(account.id, 'm3u-meta'), { epgUrl: parsed.epgUrl || '' });
      for (const [kind, catalog] of Object.entries(parsed.catalogs)) {
        await cacheSet(cacheKey(account.id, `catalog-${kind}`), catalog);
        updateSummary(account.id, kind, catalog.items.length);
      }
    }
    const data = loadAccountsData();
    const index = data.accounts.findIndex(value => value.id === account.id);
    if (index >= 0) data.accounts[index] = account;
    else data.accounts.push(account);
    data.activeId = account.id;
    saveAccountsData(data);
    return publicAccount(account);
  }

  async function fetchCatalog(account, kind) {
    if (account.type === 'm3u') {
      const parsed = parseM3u(await request(account.url, { timeoutMs: 60000 }));
      await cacheSet(cacheKey(account.id, 'm3u-sources'), parsed.sources);
      await cacheSet(cacheKey(account.id, 'm3u-meta'), { epgUrl: parsed.epgUrl || '' });
      for (const [entryKind, catalog] of Object.entries(parsed.catalogs)) {
        await cacheSet(cacheKey(account.id, `catalog-${entryKind}`), catalog);
        updateSummary(account.id, entryKind, catalog.items.length);
      }
      return parsed.catalogs[kind] || { categories: [], items: [] };
    }
    const value = await getXtreamCatalog(account, kind);
    await cacheSet(cacheKey(account.id, `catalog-${kind}`), value);
    updateSummary(account.id, kind, value.items.length);
    return value;
  }

  function chooseLiveExtension(account, preferred = 'auto') {
    const allowed = Array.isArray(account.allowedOutputFormats) ? account.allowedOutputFormats.map(value => String(value).toLowerCase()) : [];
    if (preferred === 'hls' && (!allowed.length || allowed.includes('m3u8'))) return 'm3u8';
    if (preferred === 'original' && allowed.includes('ts')) return 'ts';
    if (allowed.includes('m3u8')) return 'm3u8';
    if (allowed.includes('ts')) return 'ts';
    return preferred === 'original' ? 'ts' : 'm3u8';
  }

  function catchupDurationMinutes(start, end) {
    const startMs = Math.max(0, Number(start) || 0);
    const endMs = Math.max(startMs, Number(end) || startMs);
    return Math.max(1, Math.ceil((endMs - startMs) / 60000));
  }

  function catchupDateParts(value, timeZone = '') {
    const date = new Date(Number(value) || 0);
    const options = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    };
    if (timeZone) options.timeZone = timeZone;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(date);
      const map = {};
      for (const part of parts) map[part.type] = part.value;
      return { Y: map.year, m: map.month, d: map.day, H: map.hour, M: map.minute, S: map.second };
    } catch {
      const two = number => String(number).padStart(2, '0');
      return {
        Y: String(date.getFullYear()),
        m: two(date.getMonth() + 1),
        d: two(date.getDate()),
        H: two(date.getHours()),
        M: two(date.getMinutes()),
        S: two(date.getSeconds())
      };
    }
  }

  function formatCatchupStart(value, timeZone = '') {
    const parts = catchupDateParts(value, timeZone);
    return `${parts.Y}-${parts.m}-${parts.d}:${parts.H}-${parts.M}`;
  }

  function buildM3uCatchupUrl(template, ref = {}) {
    let url = String(template || '').trim();
    if (!url) throw new Error('Esta lista não informou uma URL de TV atrasada para o canal.');
    const start = Math.floor(Math.max(0, Number(ref.programStart) || 0) / 1000);
    const end = Math.floor(Math.max(Number(ref.programEnd) || 0, Number(ref.programStart) || 0) / 1000);
    const duration = Math.max(60, end - start);
    const values = {
      '{utc}': start, '${utc}': start,
      '{start}': start, '${start}': start,
      '{timestamp}': start, '${timestamp}': start,
      '{utcend}': end, '${utcend}': end,
      '{end}': end, '${end}': end,
      '{duration}': duration, '${duration}': duration,
      '{offset}': 0, '${offset}': 0
    };
    for (const [token, replacement] of Object.entries(values)) url = url.split(token).join(String(replacement));
    const parts = catchupDateParts(Number(ref.programStart) || 0);
    for (const [token, replacement] of Object.entries(parts)) url = url.split(`{${token}}`).join(String(replacement));
    return url;
  }

  async function getPlayback(ref, preferred) {
    const account = activePrivate();
    if (!account) throw new Error('Configure uma conta primeiro.');
    if (account.type === 'm3u') {
      const sources = await cacheGet(cacheKey(account.id, 'm3u-sources'));
      const source = sources?.[ref.sourceId || ref.id];
      if (!source) throw new Error('Fonte M3U não encontrada. Atualize a playlist.');
      const url = ref.kind === 'catchup' ? buildM3uCatchupUrl(source.catchupSource, ref) : source.url;
      const ext = String(ref.containerExtension || '').toLowerCase();
      const format = /m3u8/.test(ext) ? 'hls' : /^(ts|m2ts|mpegts)$/.test(ext) ? 'ts' : ext || 'auto';
      return { url, headers: source.headers || {}, format };
    }
    const server = normalizeServer(account.server);
    const user = encodeURIComponent(account.username);
    const pass = encodeURIComponent(account.password);
    const id = encodeURIComponent(ref.id);
    if (ref.kind === 'catchup') {
      const channelId = encodeURIComponent(ref.channelId || ref.id);
      const ext = chooseLiveExtension(account, preferred);
      const minutes = catchupDurationMinutes(ref.programStart, ref.programEnd);
      const start = encodeURIComponent(formatCatchupStart(ref.programStart, account.serverTimezone || ''));
      return { url: `${server}/timeshift/${user}/${pass}/${minutes}/${start}/${channelId}.${ext}`, format: ext === 'm3u8' ? 'hls' : 'ts', headers: {} };
    }
    if (ref.kind === 'live') {
      const ext = chooseLiveExtension(account, preferred);
      return { url: `${server}/live/${user}/${pass}/${id}.${ext}`, format: ext === 'm3u8' ? 'hls' : 'ts', headers: {} };
    }
    const folder = ref.kind === 'series' ? 'series' : 'movie';
    const ext = ref.containerExtension || 'mp4';
    return { url: `${server}/${folder}/${user}/${pass}/${id}.${ext}`, format: String(ext).toLowerCase(), headers: {} };
  }

  async function getEpisodes(ref) {
    const account = activePrivate();
    if (!account || account.type !== 'xtream') return [];
    const key = cacheKey(account.id, `series-episodes-${ref.id}`);
    const cached = await cacheGet(key);
    if (Array.isArray(cached)) return cached;
    const info = await getJson(apiUrl(account, 'get_series_info', { series_id: ref.id }));
    const episodes = Object.entries(info?.episodes || {}).flatMap(([season, list]) => (Array.isArray(list) ? list : []).map(ep => ({
      kind: 'series',
      id: String(ep.id),
      name: String(ep.title || ep.name || `${ref.name} • S${season}E${ep.episode_num || ''}`),
      image: String(ep.info?.movie_image || ep.info?.cover_big || ep.movie_image || ref.image || ''),
      categoryId: String(ref.categoryId || ''),
      containerExtension: String(ep.container_extension || 'mp4'),
      season: String(season),
      episode: String(ep.episode_num || ''),
      plot: String(ep.info?.plot || ep.plot || ''),
      releaseDate: String(ep.info?.releasedate || ep.info?.release_date || ep.releasedate || ''),
      duration: String(ep.info?.duration || ep.duration || ''),
      rating: String(ep.info?.rating || ep.rating || '')
    })));
    await cacheSet(key, episodes);
    return episodes;
  }

  async function getVodDetails(ref) {
    const account = activePrivate();
    if (!account || account.type !== 'xtream' || !ref?.id) return ref;
    const key = cacheKey(account.id, `vod-detail-${ref.id}`);
    const cached = await cacheGet(key);
    if (cached) return { ...ref, ...cached };

    const data = await getJson(apiUrl(account, 'get_vod_info', { vod_id: ref.id }));
    const info = data?.info && typeof data.info === 'object' ? data.info : {};
    const movie = data?.movie_data && typeof data.movie_data === 'object' ? data.movie_data : {};
    const backdropValue = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.find(Boolean)
      : (info.backdrop_path || info.backdrop || ref.backdrop || '');
    const details = {
      kind: 'vod',
      id: String(ref.id),
      name: String(info.name || movie.name || ref.name || 'Filme'),
      image: String(info.movie_image || info.cover_big || movie.stream_icon || ref.image || ''),
      categoryId: String(movie.category_id || ref.categoryId || ''),
      containerExtension: String(movie.container_extension || ref.containerExtension || ''),
      rating: String(info.rating || ref.rating || ''),
      year: String(info.year || ref.year || ''),
      plot: String(info.plot || info.description || ref.plot || ''),
      releaseDate: String(info.releasedate || info.release_date || ref.releaseDate || ''),
      genre: String(info.genre || ref.genre || ''),
      cast: String(info.cast || info.actors || ref.cast || ''),
      director: String(info.director || ref.director || ''),
      duration: String(info.duration || ''),
      backdrop: String(backdropValue || '')
    };
    await cacheSet(key, details);
    return { ...ref, ...details };
  }

  let avplayEnded = false;
  let avplayGeneration = 0;
  function ensureAvplayObject() {
    const shell = document.querySelector('.video-shell');
    if (!shell) return null;
    let object = document.getElementById('tizen-avplay');
    if (!object) {
      object = document.createElement('object');
      object.id = 'tizen-avplay';
      object.type = 'application/avplayer';
      object.className = 'tizen-avplay-object';
      shell.prepend(object);
    }
    shell.classList.add('native-active');
    return object;
  }

  function cleanupAvplayObject() {
    document.querySelector('.video-shell')?.classList.remove('native-active');
    document.getElementById('tizen-avplay')?.remove();
  }

  function setAvplayRect() {
    const avplay = globalThis.webapis?.avplay;
    if (!avplay) return;
    if (document.body.classList.contains('live-player-fullscreen')) {
      avplay.setDisplayRect(0, 0, 1920, 1080);
      return;
    }
    const shell = document.querySelector('.video-shell');
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const sx = 1920 / innerWidth;
    const sy = 1080 / innerHeight;
    avplay.setDisplayRect(
      Math.max(0, Math.round(rect.left * sx)),
      Math.max(0, Math.round(rect.top * sy)),
      Math.max(1, Math.round(rect.width * sx)),
      Math.max(1, Math.round(rect.height * sy))
    );
  }

  async function nativePlay(playback) {
    const avplay = globalThis.webapis?.avplay;
    if (!avplay) throw new Error('Samsung AVPlay não está disponível nesta TV.');
    const generation = ++avplayGeneration;
    try {
      const state = avplay.getState?.();
      if (state && state !== 'NONE' && state !== 'IDLE') avplay.stop();
      avplay.close?.();
    } catch {}
    ensureAvplayObject();
    avplayEnded = false;
    avplay.open(playback.url);
    try {
      avplay.setDisplayMethod(
        document.body.classList.contains('live-player-fullscreen')
          ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN'
          : 'PLAYER_DISPLAY_MODE_LETTER_BOX'
      );
    } catch {}
    avplay.setListener?.({
      onstreamcompleted: () => {
        if (generation !== avplayGeneration) return;
        avplayEnded = true;
        try { globalThis.dispatchEvent(new CustomEvent('metalloide:playback-ended')); } catch {}
      },
      onerror: error => {
        if (generation !== avplayGeneration) return;
        console.warn('AVPlay:', error);
        globalThis.dispatchEvent(new CustomEvent('metalloide:playback-error', { detail: { source: 'avplay', error: String(error || 'AVPlay') } }));
      }
    });
    setAvplayRect();
    const prepared = await new Promise((resolve, reject) => avplay.prepareAsync(
      () => resolve(generation === avplayGeneration),
      error => {
        if (generation !== avplayGeneration) return resolve(false);
        reject(new Error(`AVPlay não conseguiu preparar o vídeo (${error}).`));
      }
    ));
    if (!prepared || generation !== avplayGeneration) return;
    setAvplayRect();
    if (generation !== avplayGeneration) return;
    avplay.play();
  }

  async function nativeStop() {
    avplayGeneration += 1;
    const avplay = globalThis.webapis?.avplay;
    if (avplay) {
      try {
        const state = avplay.getState?.();
        if (state && !['NONE', 'IDLE'].includes(state)) avplay.stop();
      } catch {}
      try { avplay.close?.(); } catch {}
    }
    cleanupAvplayObject();
    avplayEnded = false;
  }

  function avplayTrackInfo() {
    const avplay = globalThis.webapis?.avplay;
    if (!avplay?.getTotalTrackInfo) return { audio: [], subtitles: [] };
    let selected = [];
    try { selected = avplay.getCurrentStreamInfo?.() || []; } catch {}
    const selectedIndexes = new Set(selected.map(track => Number(track?.index)).filter(Number.isFinite));
    let tracks = [];
    try { tracks = avplay.getTotalTrackInfo() || []; } catch {}
    const normalize = track => {
      let extra = {};
      try { extra = JSON.parse(track?.extra_info || '{}'); } catch {}
      const language = String(extra.track_lang || extra.language || extra.lang || '').trim();
      const codec = String(extra.fourCC || extra.codec || '').trim();
      const index = Number(track?.index);
      return {
        id: Number.isFinite(index) ? index : -1,
        language,
        codec,
        label: language || codec || `Faixa ${Number.isFinite(index) ? index + 1 : ''}`.trim(),
        selected: selectedIndexes.has(index)
      };
    };
    return {
      audio: tracks.filter(track => String(track?.type || '').toUpperCase() === 'AUDIO').map(normalize),
      subtitles: tracks.filter(track => String(track?.type || '').toUpperCase() === 'TEXT').map(normalize)
    };
  }

  async function avplaySelectTrack(type, id) {
    const avplay = globalThis.webapis?.avplay;
    if (!avplay) return false;
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType === 'subtitle') {
      if (Number(id) < 0) {
        try { avplay.setSilentSubtitle?.(true); } catch {}
        return true;
      }
      try { avplay.setSilentSubtitle?.(false); } catch {}
      avplay.setSelectTrack?.('TEXT', Number(id));
      return true;
    }
    if (normalizedType === 'audio') {
      avplay.setSelectTrack?.('AUDIO', Number(id));
      return true;
    }
    return false;
  }

  function registerRemoteKeys() {
    const device = globalThis.tizen?.tvinputdevice;
    if (!device?.registerKey) return;
    for (const key of ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'ChannelUp', 'ChannelDown']) {
      try { device.registerKey(key); } catch {}
    }
  }

  function handleMediaKey(event) {
    const avplay = globalThis.webapis?.avplay;
    if (!avplay || !document.querySelector('.video-shell.native-active')) return;
    const key = String(event.key || '');
    const code = Number(event.keyCode || event.which || 0);
    try {
      const state = avplay.getState?.();
      const play = code === 415 || key === 'MediaPlay' || key === 'XF86AudioPlay';
      const pause = code === 19 || key === 'MediaPause' || key === 'XF86AudioPause';
      const playPause = code === 10252 || key === 'MediaPlayPause' || key === 'PlayPause';
      if (play || (playPause && state === 'PAUSED')) avplay.play();
      else if (pause || (playPause && state === 'PLAYING')) avplay.pause();
      else if (code === 413 || key === 'MediaStop') nativeStop();
      else if (code === 417 || key === 'MediaFastForward') avplay.jumpForward?.(30000);
      else if (code === 412 || key === 'MediaRewind') avplay.jumpBackward?.(30000);
    } catch {}
  }

  registerRemoteKeys();
  document.addEventListener('keydown', handleMediaKey);
  window.addEventListener('resize', () => {
    if (document.querySelector('.video-shell.native-active')) setAvplayRect();
  });

  globalThis.desktopAPI = Object.freeze({
    getAppInfo: async () => ({ version: '0.9.33', platform: 'Samsung TV (Tizen)', portable: false, deviceClass: 'tv' }),
    exit: () => {
      try { globalThis.tizen?.application?.getCurrentApplication?.().exit(); } catch {}
    },
    accounts: Object.freeze({
      list: async () => {
        const data = loadAccountsData();
        return { activeId: data.activeId, accounts: data.accounts.map(publicAccount) };
      },
      save: saveAccount,
      activate: async id => {
        const data = loadAccountsData();
        if (!data.accounts.some(account => account.id === id)) throw new Error('Conta não encontrada.');
        data.activeId = id;
        saveAccountsData(data);
        return publicAccount(data.accounts.find(account => account.id === id));
      },
      remove: async id => {
        const data = loadAccountsData();
        data.accounts = data.accounts.filter(account => account.id !== id);
        if (data.activeId === id) data.activeId = data.accounts[0]?.id || null;
        saveAccountsData(data);
        await cacheDeletePrefix(`${id}:`);
        return { activeId: data.activeId, accounts: data.accounts.map(publicAccount) };
      }
    }),
    catalog: Object.freeze({
      summary: async () => {
        const account = activePrivate();
        if (!account) return { live: 0, vod: 0, series: 0, radio: 0, cached: false };
        const counts = readJson(SUMMARY_KEY, {})[account.id] || {};
        return { live: counts.live || 0, vod: counts.vod || 0, series: counts.series || 0, radio: counts.radio || 0, cached: Object.keys(counts).length > 0 };
      },
      get: async (kind, { refresh = false } = {}) => {
        if (!['live', 'vod', 'series', 'radio'].includes(kind)) throw new Error('Catálogo inválido.');
        const account = activePrivate();
        if (!account) throw new Error('Configure uma conta primeiro.');
        if (!refresh) {
          const cached = await cacheGet(cacheKey(account.id, `catalog-${kind}`));
          if (cached) return { ...cached, stale: false, source: 'cache' };
        }
        const value = await fetchCatalog(account, kind);
        return { ...value, updatedAt: Date.now(), stale: false, source: 'network' };
      },
      refreshAll: async () => {
        const account = activePrivate();
        if (!account) throw new Error('Configure uma conta primeiro.');
        const counts = {};
        if (account.type === 'm3u') {
          const parsed = parseM3u(await request(account.url, { timeoutMs: 60000 }));
          await cacheSet(cacheKey(account.id, 'm3u-sources'), parsed.sources);
          await cacheSet(cacheKey(account.id, 'm3u-meta'), { epgUrl: parsed.epgUrl || '' });
          for (const [kind, catalog] of Object.entries(parsed.catalogs)) {
            await cacheSet(cacheKey(account.id, `catalog-${kind}`), catalog);
            counts[kind] = catalog.items.length;
            updateSummary(account.id, kind, catalog.items.length);
          }
          return { counts };
        }
        for (const kind of ['live', 'vod', 'series']) {
          const catalog = await fetchCatalog(account, kind);
          counts[kind] = catalog.items.length;
        }
        await cacheDeletePrefix(`${account.id}:series-episodes-`);
        await cacheDeletePrefix(`${account.id}:vod-detail-`);
        await cacheSet(cacheKey(account.id, 'catalog-radio'), { categories: [], items: [] });
        counts.radio = 0;
        updateSummary(account.id, 'radio', 0);
        return { counts };
      },
      episodes: getEpisodes,
      details: getVodDetails
    }),
    playback: Object.freeze({ get: getPlayback }),
    nativePlayer: Object.freeze({
      play: nativePlay,
      stop: nativeStop,
      pause: async () => globalThis.webapis?.avplay?.pause?.(),
      resume: async () => globalThis.webapis?.avplay?.play?.(),
      state: async () => {
        const avplay = globalThis.webapis?.avplay;
        const playbackState = String(avplay?.getState?.() || '');
        return {
          positionMs: Number(avplay?.getCurrentTime?.() || 0),
          durationMs: Number(avplay?.getDuration?.() || 0),
          ended: avplayEnded,
          playbackState,
          paused: playbackState === 'PAUSED'
        };
      },
      seekTo: async positionMs => globalThis.webapis?.avplay?.seekTo?.(Math.max(0, Number(positionMs) || 0)),
      tracks: async () => avplayTrackInfo(),
      selectTrack: avplaySelectTrack
    }),
    epg: Object.freeze({
      getMany: async values => {
        const account = activePrivate();
        if (!account) return [];
        const refs = (Array.isArray(values) ? values : []).slice(0, 60).map(value => {
          if (value && typeof value === 'object') {
            return {
              id: String(value.id ?? value.sourceId ?? ''),
              tvgId: String(value.tvgId ?? ''),
              name: String(value.name ?? '')
            };
          }
          return { id: String(value ?? ''), tvgId: '', name: '' };
        }).filter(value => value.id || value.tvgId || value.name);
        if (account.type === 'm3u') {
          const guide = await ensureM3uGuide(account);
          if (!guide) return [];
          return refs.map(ref => ({
            streamId: ref.id || ref.tvgId || ref.name,
            ...selectNowNext(m3uGuideRows(guide, ref))
          }));
        }
        const results = [];
        let cursor = 0;
        const workers = Array.from({ length: Math.min(4, refs.length) }, async () => {
          while (cursor < refs.length) {
            const id = refs[cursor++].id;
            if (!id) continue;
            try {
              const rows = await getShortEpg(account, id);
              results.push({ streamId: id, now: rows[0] || null, next: rows[1] || null });
            } catch {
              results.push({ streamId: id, now: null, next: null });
            }
          }
        });
        await Promise.all(workers);
        return results;
      },
      getArchive: async ref => {
        const account = activePrivate();
        if (!account || !ref) return [];
        if (account.type === 'm3u') {
          let sources = await cacheGet(cacheKey(account.id, 'm3u-sources'));
          let source = sources?.[ref.sourceId || ref.id];
          if (!source?.catchupSource) {
            const parsed = parseM3u(await request(account.url, { timeoutMs: 60000 }));
            sources = parsed.sources;
            await cacheSet(cacheKey(account.id, 'm3u-sources'), parsed.sources);
            await cacheSet(cacheKey(account.id, 'm3u-meta'), { epgUrl: parsed.epgUrl || '' });
            source = sources?.[ref.sourceId || ref.id];
          }
          if (!source?.catchupSource) return [];
          const guide = await ensureM3uGuide(account);
          if (!guide) return [];
          const days = Math.max(1, Math.min(Number(ref.catchupDays || source.catchupDays) || 3, 14));
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          return m3uGuideRows(guide, ref)
            .filter(row => row?.start && row?.end && row.end <= Date.now() && row.end >= cutoff)
            .sort((a, b) => b.start - a.start)
            .slice(0, 96);
        }
        const rows = await getArchiveEpg(account, ref.id, 96);
        const days = Math.max(1, Math.min(Number(ref.tvArchiveDuration) || 3, 14));
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return rows.filter(row => row.end >= cutoff);
      }
    }),
    backup: Object.freeze({
      export: async data => {
        const clean = JSON.stringify(data, null, 2);
        localStorage.setItem(BACKUP_KEY, clean);
        try {
          const blob = new Blob([clean], { type: 'application/json' });
          const anchor = document.createElement('a');
          anchor.href = URL.createObjectURL(blob);
          anchor.download = `mtplayer-backup-${new Date().toISOString().slice(0, 10)}.json`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
        } catch {}
        return true;
      },
      import: async () => {
        const stored = localStorage.getItem(BACKUP_KEY);
        return stored ? JSON.parse(stored) : null;
      }
    }),
    log: async (level, message) => {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](`[MTPLAYER] ${String(message || '')}`);
    }
  });
})();
