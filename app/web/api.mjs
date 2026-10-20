import { createHttp, normalizeHttpUrl } from './http.mjs';
import { parseM3u } from './m3u.mjs';
import { createXtreamProvider } from './xtream.mjs';
import { buildM3uCatchupUrl } from './catchup.mjs';
import { decodeXmltvBuffer, parseXmltv, selectNowNext } from './xmltv.mjs';

const SESSION_KEY = 'mtplayer-web-accounts-v1';
const KINDS = ['live', 'vod', 'series', 'radio'];
const emptyCatalog = () => ({ categories: [], items: [] });

export async function accountIdentity(account) {
  // Reconnecting the same account preserves the association with local profiles.
  const identity = account.type === 'xtream'
    ? ['xtream', account.server, account.username]
    : ['m3u', account.url || account.playlistText];
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return `web-${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export function createWebAPI({ storage = globalThis.sessionStorage, http = createHttp() } = {}) {
  let saved;
  try { saved = JSON.parse(storage.getItem(SESSION_KEY) || '{}'); }
  catch { saved = {}; }
  let accounts = Array.isArray(saved.accounts) ? saved.accounts.filter(row => row?.id && ['xtream', 'm3u'].includes(row.type)) : [];
  let activeId = accounts.some(row => row.id === saved.activeId) ? saved.activeId : accounts[0]?.id || '';
  const catalogs = new Map();
  const playlists = new Map();
  const loads = new Map();
  const guides = new Map();
  const xtream = createXtreamProvider(http);
  const active = () => {
    const account = accounts.find(row => row.id === activeId);
    if (!account) throw new Error('Configure uma conta primeiro.');
    return account;
  };
  const publicList = () => ({
    activeId,
    accounts: accounts.map(({ id, type, name, status, expiresAt, activeConnections, maxConnections }) =>
      ({ id, type, name, status, expiresAt, activeConnections, maxConnections }))
  });
  function commit(nextAccounts, nextId) {
    try { storage.setItem(SESSION_KEY, JSON.stringify({ accounts: nextAccounts, activeId: nextId })); }
    catch { throw new Error('Não foi possível guardar a sessão desta aba. Libere armazenamento ou use uma playlist menor/por URL.'); }
    accounts = nextAccounts;
    activeId = nextId;
    return publicList();
  }
  function once(key, work) {
    if (!loads.has(key)) loads.set(key, Promise.resolve().then(work).finally(() => loads.delete(key)));
    return loads.get(key);
  }
  function keepPlaylist(account, parsed) {
    playlists.set(account.id, parsed);
    for (const kind of KINDS) catalogs.set(`${account.id}:${kind}`, {
      ...parsed.catalogs[kind], updatedAt: Date.now(), source: 'browser', stale: false
    });
    guides.delete(account.id);
    return parsed;
  }
  function loadPlaylist(account, refresh = false) {
    if (!refresh && playlists.has(account.id)) return Promise.resolve(playlists.get(account.id));
    return once(`playlist:${account.id}`, async () => {
      const text = account.playlistText || await http.getText(account.url);
      return keepPlaylist(account, parseM3u(text));
    });
  }
  async function catalogFor(account, kind, { refresh = false } = {}) {
    if (!KINDS.includes(kind)) throw new Error('Catálogo inválido.');
    const key = `${account.id}:${kind}`;
    const cached = catalogs.get(key);
    if (cached && !refresh) return cached;
    try {
      if (account.type === 'm3u') {
        await loadPlaylist(account, refresh);
        return catalogs.get(key);
      }
      return await once(`catalog:${key}`, async () => {
        const result = { ...await xtream.getCatalog(account, kind), updatedAt: Date.now(), source: 'browser', stale: false };
        catalogs.set(key, result);
        return result;
      });
    } catch (error) {
      if (cached) return { ...cached, stale: true, offline: true };
      throw error;
    }
  }
  async function guideFor(account) {
    const cached = guides.get(account.id);
    if (cached && Date.now() - cached.generatedAt < 2 * 3600000) return cached;
    return once(`guide:${account.id}`, async () => {
      const parsed = await loadPlaylist(account);
      if (!parsed.epgUrl) return { byChannel: Object.create(null) };
      const bytes = await http.getBuffer(parsed.epgUrl, { maxBytes: 60 * 1024 * 1024, timeoutMs: 60000 });
      const guide = parseXmltv(await decodeXmltvBuffer(bytes), { pastMs: 7 * 86400000 });
      guides.set(account.id, guide);
      return guide;
    });
  }
  const guideRows = (guide, ref) => {
    for (const candidate of [ref.tvgId, ref.name].filter(Boolean)) {
      const key = Object.keys(guide.byChannel).find(id => id.toLocaleLowerCase() === String(candidate).toLocaleLowerCase());
      if (key) return guide.byChannel[key];
    }
    return [];
  };
  return Object.freeze({
    getAppInfo: async () => ({ version: '0.2.13-web.2', platform: 'Web / GitHub Pages', portable: false }),
    // Do not persist renderer logs: messages can contain provider URLs/tokens.
    log: async () => {},
    accounts: Object.freeze({
      list: async () => publicList(),
      save: async (draft = {}) => {
        const type = draft.type === 'm3u' ? 'm3u' : 'xtream';
        const account = { type, name: String(draft.name || 'Minha lista').trim().slice(0, 120) || 'Minha lista', status: 'Active' };
        let parsed;
        if (type === 'xtream') {
          if (!draft.server || !draft.username || !draft.password) throw new Error('Preencha servidor, usuário e senha.');
          account.server = xtream.normalizeServer(draft.server);
          normalizeHttpUrl(account.server);
          account.username = String(draft.username).trim();
          account.password = String(draft.password);
          const auth = await xtream.authenticate(account);
          Object.assign(account, {
            status: auth.status, expiresAt: auth.expiresAt, activeConnections: auth.activeConnections,
            maxConnections: auth.maxConnections, allowedOutputFormats: auth.allowedOutputFormats,
            apiEndpoint: auth.apiEndpoint, serverTimezone: auth.serverInfo?.timezone || ''
          });
        } else {
          if (draft.playlistText) {
            account.playlistText = String(draft.playlistText);
            if (new TextEncoder().encode(account.playlistText).length > 50 * 1024 * 1024) throw new Error('A playlist excede 50 MB.');
          } else account.url = normalizeHttpUrl(draft.url);
          parsed = parseM3u(account.playlistText || await http.getText(account.url));
        }
        account.id = await accountIdentity(account);
        const result = commit([...accounts.filter(row => row.id !== account.id), account], account.id);
        for (const kind of KINDS) catalogs.delete(`${account.id}:${kind}`);
        guides.delete(account.id);
        if (parsed) keepPlaylist(account, parsed);
        return result;
      },
      activate: async id => {
        if (!accounts.some(row => row.id === id)) throw new Error('Conta não encontrada.');
        return commit(accounts, id);
      },
      remove: async id => {
        const next = accounts.filter(row => row.id !== id);
        const result = commit(next, activeId === id ? next[0]?.id || '' : activeId);
        for (const kind of KINDS) catalogs.delete(`${id}:${kind}`);
        playlists.delete(id);
        guides.delete(id);
        return result;
      }
    }),
    catalog: Object.freeze({
      summary: async () => Object.fromEntries([
        ...KINDS.map(kind => [kind, catalogs.get(`${activeId}:${kind}`)?.items.length || 0]),
        ['cached', KINDS.some(kind => catalogs.has(`${activeId}:${kind}`))]
      ]),
      get: async (kind, options) => catalogFor(active(), kind, options),
      refreshAll: async () => {
        const account = active();
        if (account.type === 'm3u') await loadPlaylist(account, true);
        const results = await Promise.all(KINDS.map(kind => catalogFor(account, kind, { refresh: account.type !== 'm3u' })));
        if (results.some(row => row.offline)) throw new Error('A atualização falhou. O catálogo anterior foi mantido em memória.');
        return { counts: Object.fromEntries(KINDS.map((kind, index) => [kind, results[index].items.length])) };
      },
      details: async ref => {
        const account = active();
        return account.type === 'xtream' && ref.kind === 'vod' ? xtream.getVodDetails(account, ref) : ref;
      },
      episodes: async ref => {
        const account = active();
        if (account.type === 'xtream') return xtream.getSeriesEpisodes(account, ref.id, ref.name, ref.image, ref.categoryId);
        // An M3U entry is already a playable source, not a series API container.
        return [{ ...ref, season: ref.season || '1', episode: ref.episode || '1', seriesId: ref.id }];
      }
    }),
    playback: Object.freeze({
      get: async (ref, preferred = 'auto') => {
        const account = active();
        let playback;
        if (account.type === 'xtream') {
          const containerExtension = /^[a-z0-9]{1,10}$/i.test(ref.containerExtension || '') ? ref.containerExtension : '';
          playback = xtream.playback(account, { ...ref, containerExtension }, preferred);
        } else {
          const parsed = await loadPlaylist(account);
          const source = parsed.sources[ref.sourceId || ref.channelId || ref.id];
          if (!source) throw new Error('Fonte não encontrada. Atualize a playlist.');
          if (Object.keys(source.headers || {}).length) throw new Error('Este stream exige User-Agent/Referer personalizado, indisponível no navegador. Use um link web fornecido pelo provedor.');
          const url = ref.kind === 'catchup' ? buildM3uCatchupUrl(source.catchupSource, { start: ref.programStart, end: ref.programEnd }) : source.url;
          const ext = new URL(normalizeHttpUrl(url)).pathname.split('.').pop().toLowerCase();
          playback = { url, headers: {}, format: ext === 'm3u8' ? 'hls' : ['ts', 'm2ts', 'mpegts'].includes(ext) ? 'ts' : ext };
        }
        return { ...playback, url: normalizeHttpUrl(playback.url) };
      }
    }),
    epg: Object.freeze({
      getMany: async values => {
        const account = active();
        const refs = (Array.isArray(values) ? values : []).slice(0, 60).map(value => typeof value === 'object' && value ? value : { id: String(value) });
        if (account.type === 'm3u') {
          const guide = await guideFor(account);
          return refs.map(ref => ({ streamId: String(ref.id), ...selectNowNext(guideRows(guide, ref)) }));
        }
        const results = [];
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(refs.length, 6) }, async () => {
          while (cursor < refs.length) {
            const ref = refs[cursor++];
            try {
              const rows = await xtream.getShortEpg(account, ref.id, 2);
              results.push({ streamId: String(ref.id), now: rows[0] || null, next: rows[1] || null });
            } catch { results.push({ streamId: String(ref.id), now: null, next: null }); }
          }
        }));
        return results;
      },
      getArchive: async ref => {
        const account = active();
        if (account.type === 'xtream') return xtream.getArchiveEpg(account, ref.id, 96);
        if (!ref.catchup) return [];
        const days = Math.min(Math.max(Number(ref.catchupDays) || 3, 1), 14);
        return guideRows(await guideFor(account), ref).filter(row => row.end <= Date.now() && row.end >= Date.now() - days * 86400000).reverse().slice(0, 96);
      }
    })
  });
}
