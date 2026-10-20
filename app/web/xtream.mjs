function normalizeServer(server) {
  let value = String(server || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
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

function authAccepted(user) {
  if (!user || typeof user !== 'object') return false;
  const auth = String(user.auth ?? '').trim().toLowerCase();
  if (auth === '1' || auth === 'true') return true;
  if (auth) return false;
  const status = String(user.status ?? '').trim().toLowerCase();
  return ['active', 'enabled'].includes(status)
    && (user.username != null || user.exp_date != null || user.max_connections != null);
}

function allowedFormats(user) {
  if (Array.isArray(user?.allowed_output_formats)) return user.allowed_output_formats.map(String);
  return String(user?.allowed_output_formats || '').split(/[,;\s]+/).map(value => value.trim()).filter(Boolean);
}

function decodeBase64Text(value) {
  if (!value) return '';
  try { return new TextDecoder().decode(Uint8Array.from(atob(String(value)), char => char.charCodeAt(0))); } catch { return String(value); }
}

import { durationMinutes, formatXtreamStart } from './catchup.mjs';

function normalizeCategory(raw) {
  return {
    id: String(raw?.category_id ?? raw?.id ?? ''),
    name: String(raw?.category_name ?? raw?.name ?? 'Categoria')
  };
}

function normalizeItem(kind, raw) {
  const id = raw?.stream_id ?? raw?.series_id ?? raw?.id;
  const backdrop = Array.isArray(raw?.backdrop_path)
    ? raw.backdrop_path.find(Boolean)
    : (raw?.backdrop_path ?? raw?.backdrop ?? '');
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
    // The provider's catalog inclusion date is distinct from the film's release date
    // and from last_modified (which can change when episodes or metadata change).
    addedAt: String(raw?.added ?? raw?.date_added ?? raw?.created_at ?? ''),
    genre: String(raw?.genre ?? ''),
    cast: String(raw?.cast ?? raw?.actors ?? ''),
    director: String(raw?.director ?? ''),
    backdrop: String(backdrop || ''),
    tvArchive: Boolean(Number(raw?.tv_archive || 0)),
    tvArchiveDuration: Math.max(0, Number(raw?.tv_archive_duration) || 0)
  };
}

function createXtreamProvider(http, logger) {
  function apiUrl(account, action, extra = {}, endpoint = account.apiEndpoint || 'player_api.php') {
    const apiEndpoint = endpoint === 'panel_api.php' ? 'panel_api.php' : 'player_api.php';
    const url = new URL(`${normalizeServer(account.server)}/${apiEndpoint}`);
    url.searchParams.set('username', account.username);
    url.searchParams.set('password', account.password);
    if (action) url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return url.toString();
  }

  async function authenticate(account) {
    const endpoints = account.apiEndpoint === 'panel_api.php'
      ? ['panel_api.php', 'player_api.php']
      : ['player_api.php', 'panel_api.php'];
    let rejected = false;
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const data = await http.getJson(apiUrl(account, null, {}, endpoint), { timeoutMs: 35000 });
        const user = data?.user_info && typeof data.user_info === 'object'
          ? data.user_info
          : (data && typeof data === 'object' && ('auth' in data || 'status' in data) ? data : null);
        if (!authAccepted(user)) {
          if (user) rejected = true;
          else lastError = new Error('O servidor retornou um formato Xtream incompatível.');
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
          serverInfo: {
            url: data.server_info?.url || null,
            port: data.server_info?.port || null,
            httpsPort: data.server_info?.https_port || null,
            timezone: data.server_info?.timezone || null
          }
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (rejected) throw new Error('Usuário ou senha recusados pelo servidor.');
    throw new Error(`Não foi possível conectar à API Xtream. ${lastError?.message || 'Servidor indisponível.'}`);
  }

  async function getCatalog(account, kind) {
    const map = {
      live: ['get_live_categories', 'get_live_streams'],
      vod: ['get_vod_categories', 'get_vod_streams'],
      series: ['get_series_categories', 'get_series']
    };
    if (!map[kind]) return { categories: [], items: [] };
    const [categoryAction, itemAction] = map[kind];
    const [categories, items] = await Promise.all([
      http.getJson(apiUrl(account, categoryAction)),
      http.getJson(apiUrl(account, itemAction))
    ]);
    const result = {
      categories: Array.isArray(categories) ? categories.map(normalizeCategory) : [],
      items: Array.isArray(items) ? items.map(item => normalizeItem(kind, item)) : []
    };
    logger?.info('Catálogo Xtream carregado.', { kind, count: result.items.length });
    return result;
  }

  async function getSeriesEpisodes(account, seriesId, seriesName, image, categoryId) {
    const info = await http.getJson(apiUrl(account, 'get_series_info', { series_id: seriesId }));
    const episodes = Object.entries(info?.episodes || {}).flatMap(([season, list]) => (Array.isArray(list) ? list : []).map(ep => ({
      kind: 'series',
      id: String(ep.id),
      name: String(ep.title || ep.name || `${seriesName} • S${season}E${ep.episode_num || ''}`),
      image: String(ep.info?.movie_image || ep.info?.cover_big || ep.movie_image || image || ''),
      categoryId: String(categoryId || ''),
      containerExtension: String(ep.container_extension || 'mp4'),
      season: String(season),
      episode: String(ep.episode_num || ''),
      plot: String(ep.info?.plot || ep.plot || ''),
      releaseDate: String(ep.info?.releasedate || ep.info?.release_date || ep.releasedate || ''),
      duration: String(ep.info?.duration || ep.duration || ''),
      rating: String(ep.info?.rating || ep.rating || '')
    })));
    return episodes;
  }

  async function getVodDetails(account, ref) {
    if (!ref?.id) return ref;
    const data = await http.getJson(apiUrl(account, 'get_vod_info', { vod_id: ref.id }));
    const info = data?.info && typeof data.info === 'object' ? data.info : {};
    const movie = data?.movie_data && typeof data.movie_data === 'object' ? data.movie_data : {};
    const backdropValue = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.find(Boolean)
      : (info.backdrop_path || info.backdrop || ref.backdrop || '');
    return {
      ...ref,
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
      duration: String(info.duration || ref.duration || ''),
      backdrop: String(backdropValue || '')
    };
  }

  async function getShortEpg(account, streamId, limit = 2) {
    const data = await http.getJson(apiUrl(account, 'get_short_epg', { stream_id: streamId, limit }));
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
      data = await http.getJson(apiUrl(account, 'get_simple_data_table', { stream_id: streamId }));
    } catch {}
    if (!Array.isArray(data?.epg_listings)) {
      data = await http.getJson(apiUrl(account, 'get_short_epg', { stream_id: streamId, limit: Math.min(Math.max(Number(limit) || 96, 2), 200) }));
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

  function chooseLiveExtension(account, preferred = 'auto') {
    const allowed = Array.isArray(account.allowedOutputFormats) ? account.allowedOutputFormats.map(v => String(v).toLowerCase()) : [];
    if (preferred === 'hls' && (!allowed.length || allowed.includes('m3u8'))) return 'm3u8';
    if (preferred === 'original' && allowed.includes('ts')) return 'ts';
    if (allowed.includes('m3u8')) return 'm3u8';
    if (allowed.includes('ts')) return 'ts';
    return preferred === 'original' ? 'ts' : 'm3u8';
  }

  function playback(account, ref, preferred = 'auto') {
    const server = normalizeServer(account.server);
    const user = encodeURIComponent(account.username);
    const pass = encodeURIComponent(account.password);
    const id = encodeURIComponent(ref.id);
    if (ref.kind === 'catchup') {
      const channelId = encodeURIComponent(ref.channelId || ref.id);
      const ext = chooseLiveExtension(account, preferred);
      const minutes = durationMinutes(ref.programStart, ref.programEnd);
      const start = encodeURIComponent(formatXtreamStart(ref.programStart, account.serverTimezone || ''));
      return { url: `${server}/timeshift/${user}/${pass}/${minutes}/${start}/${channelId}.${ext}`, format: ext === 'm3u8' ? 'hls' : 'ts', headers: {} };
    }
    if (ref.kind === 'live') {
      const ext = chooseLiveExtension(account, preferred);
      return { url: `${server}/live/${user}/${pass}/${id}.${ext}`, format: ext === 'm3u8' ? 'hls' : 'ts', headers: {} };
    }
    if (ref.kind === 'vod') {
      const ext = ref.containerExtension || 'mp4';
      return { url: `${server}/movie/${user}/${pass}/${id}.${ext}`, format: ext.toLowerCase(), headers: {} };
    }
    if (ref.kind === 'series') {
      const ext = ref.containerExtension || 'mp4';
      return { url: `${server}/series/${user}/${pass}/${id}.${ext}`, format: ext.toLowerCase(), headers: {} };
    }
    throw new Error('Tipo de conteúdo não suportado para reprodução.');
  }

  return { authenticate, getCatalog, getSeriesEpisodes, getVodDetails, getShortEpg, getArchiveEpg, playback, apiUrl, normalizeServer };
}

export { createXtreamProvider, normalizeServer, normalizeItem, decodeBase64Text, authAccepted, allowedFormats };
