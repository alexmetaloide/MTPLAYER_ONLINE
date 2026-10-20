import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAPI, accountIdentity } from '../app/web/api.mjs';
import { parseM3u } from '../app/web/m3u.mjs';
import { normalizeServer, decodeBase64Text } from '../app/web/xtream.mjs';
import { normalizeHttpUrl, createHttp } from '../app/web/http.mjs';
import { validateBackup } from '../app/web/files.mjs';
import { decodeXmltvBuffer, parseXmltv, selectNowNext } from '../app/web/xmltv.mjs';
import { gzipSync } from 'node:zlib';
import { ensureProfilesForAccounts, addProfile, updateProfile } from '../app/core/profiles.mjs';

const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
};
const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="news" group-title="TV",Canal teste
https://example.com/live.m3u8
#EXTINF:-1 group-title="Filmes",Filme teste
https://example.com/movie.mp4
#EXTINF:-1 group-title="Séries",Série teste
https://example.com/episode.mp4
#EXTINF:-1 group-title="Radio",Rádio teste
https://example.com/radio.mp3`;

test('M3U: classificação, identidade estável e rejeição de formato inválido', () => {
  const parsed = parseM3u(playlist);
  for (const kind of ['live', 'vod', 'series', 'radio']) assert.equal(parsed.catalogs[kind].items.length, 1);
  assert.deepEqual(parsed, parseM3u(playlist));
  assert.throws(() => parseM3u('<html>falha</html>'), /EXTM3U/);
});

test('HTTP: protocolos, conteúdo misto e mensagens sem credenciais', async () => {
  for (const url of ['javascript:alert(1)', 'file:///x', 'https://user:pass@example.com']) assert.throws(() => normalizeHttpUrl(url));
  assert.throws(() => normalizeHttpUrl('http://example.com', 'https:'), /HTTPS/);
  assert.equal(normalizeServer('example.com/player_api.php?username=secret'), 'https://example.com');
  assert.throws(() => normalizeServer('ftp://example.com'), /HTTP/);
  const http = createHttp(async () => { throw new TypeError('secret-token'); });
  await assert.rejects(http.getText('https://example.com/?password=private'), error => /CORS/.test(error.message) && !/private|secret-token/.test(error.message));
});

test('HTTP: limite de leitura e JSON inválido', async () => {
  let options;
  const http = createHttp(async (_url, opts) => { options = opts; return new Response('123456789'); });
  await assert.rejects(http.getText('https://example.com', { maxBytes: 4 }), /limite/);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  const invalid = createHttp(async () => new Response('<html/>'));
  await assert.rejects(invalid.getJson('https://example.com'), /JSON/);
});

test('HTTP: timeout interrompe tentativa e produz erro visível sem URL/senha', async () => {
  const http = createHttp((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Abortado', 'AbortError')), { once: true });
  }));
  await assert.rejects(http.getText('https://example.com/?password=segredo', { timeoutMs: 10 }), error => /demorou/.test(error.message) && !error.message.includes('segredo'));
});

test('M3U local: conta pública, catálogo, séries, reprodução e sessão', async () => {
  const storage = memory();
  const api = createWebAPI({ storage });
  await api.accounts.save({ type: 'm3u', name: 'Local', playlistText: playlist });
  const list = await api.accounts.list();
  assert.equal(list.accounts[0].playlistText, undefined);
  const live = await api.catalog.get('live');
  assert.equal((await api.catalog.summary()).live, 1);
  assert.equal((await api.playback.get(live.items[0])).format, 'hls');
  const series = await api.catalog.get('series');
  assert.equal((await api.catalog.episodes(series.items[0])).length, 1);
  const reloaded = createWebAPI({ storage });
  assert.equal((await reloaded.accounts.list()).activeId, list.activeId);
  assert.equal((await reloaded.catalog.get('vod')).items.length, 1);
  await reloaded.accounts.remove(list.activeId);
  assert.equal((await reloaded.accounts.list()).accounts.length, 0);
  await assert.rejects(reloaded.catalog.get('vod'), /Configure/);
});

test('identidade de conta reconectada preserva perfis; senha não faz parte da identidade', async () => {
  const base = { type: 'xtream', server: 'https://example.com', username: 'user' };
  assert.equal(await accountIdentity({ ...base, password: 'old' }), await accountIdentity({ ...base, password: 'new' }));
  assert.notEqual(await accountIdentity(base), await accountIdentity({ ...base, username: 'other' }));
});

test('fim da sessão não apaga perfis persistentes nem bloqueios', () => {
  let state = ensureProfilesForAccounts({}, [{ id: 'account' }]);
  const added = addProfile(state, 'account', { name: 'Família' });
  state = updateProfile(added.state, 'account', added.profile.id, { blockedTitles: [{ kind: 'vod', id: '42', name: 'Bloqueado' }] }).state;
  const disconnected = ensureProfilesForAccounts(state, []);
  assert.equal(disconnected.profiles.length, 2);
  const reconnected = ensureProfilesForAccounts(disconnected, [{ id: 'account' }]);
  assert.equal(reconnected.profiles.find(row => row.id === added.profile.id).blockedTitles[0].id, '42');
});

test('download M3U compartilhado, troca de conta isolada e cache offline', async () => {
  let requests = 0;
  let fail = false;
  const api = createWebAPI({ storage: memory(), http: { getText: async () => { requests++; if (fail) throw new Error('offline'); return playlist; } } });
  await api.accounts.save({ type: 'm3u', name: 'A', url: 'https://example.com/list' });
  const firstId = (await api.accounts.list()).activeId;
  const [a, b] = await Promise.all([api.catalog.get('live'), api.catalog.get('vod')]);
  assert.equal(requests, 1);
  assert.equal(a.items.length + b.items.length, 2);
  await api.accounts.save({ type: 'm3u', name: 'B', playlistText: playlist.replace('Canal teste', 'Outra conta') });
  assert.equal((await api.catalog.get('live')).items[0].name, 'Outra conta');
  await api.accounts.activate(firstId);
  fail = true;
  assert.equal((await api.catalog.get('live', { refresh: true })).offline, true);
  assert.equal((await api.catalog.get('live')).items[0].name, 'Canal teste');
});

test('falha de armazenamento não substitui conta; cabeçalhos nativos são recusados', async () => {
  const api = createWebAPI({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  await assert.rejects(api.accounts.save({ type: 'm3u', playlistText: playlist }), /armazenamento/);
  assert.equal((await api.accounts.list()).accounts.length, 0);
  const second = createWebAPI({ storage: memory() });
  await second.accounts.save({ type: 'm3u', playlistText: playlist.replace('https://example.com/live.m3u8', '#EXTVLCOPT:http-user-agent=Custom\nhttps://example.com/live.m3u8') });
  await assert.rejects(second.playback.get((await second.catalog.get('live')).items[0]), /User-Agent/);
});

test('Xtream: autenticação, catálogos, episódios, EPG, links e senha não exposta', async () => {
  const http = { getJson: async value => {
    const url = new URL(value);
    const action = url.searchParams.get('action');
    if (!action) return { user_info: { auth: 1, status: 'Active', allowed_output_formats: ['m3u8'] } };
    if (action === 'get_live_categories') return [{ category_id: 1, category_name: 'TV' }];
    if (action === 'get_live_streams') return [{ stream_id: 7, name: 'Canal' }];
    if (action === 'get_series_info') return { episodes: { 1: [{ id: 8, title: 'Piloto', episode_num: 1 }] } };
    if (action === 'get_short_epg') return { epg_listings: [{ title: btoa('Agora'), start_timestamp: 1, stop_timestamp: 2 }] };
    return [];
  } };
  const api = createWebAPI({ storage: memory(), http });
  await api.accounts.save({ server: 'https://example.com', username: 'u test', password: 'p/test', name: 'Teste' });
  assert.ok(!JSON.stringify(await api.accounts.list()).includes('p/test'));
  const item = (await api.catalog.get('live')).items[0];
  assert.equal((await api.playback.get(item)).url, 'https://example.com/live/u%20test/p%2Ftest/7.m3u8');
  assert.equal((await api.catalog.episodes({ id: '9', name: 'Série' }))[0].episode, '1');
  assert.equal((await api.epg.getMany(['7']))[0].now.title, 'Agora');
  assert.equal(decodeBase64Text(Buffer.from('Olá, ação').toString('base64')), 'Olá, ação');
});

test('backup: remove credenciais, URLs e PINs; valida versão', () => {
  const safe = validateBackup({ version: 6, password: 'private-password', accounts: [{ password: 'private-password' }],
    favorites: [{ id: '1', kind: 'vod', name: 'Teste', image: 'https://example.com/?token=private-token', url: 'https://private-stream' }],
    profiles: { profiles: [{ id: 'p', accountId: 'a', pin: '1234', blockedTitles: [{ kind: 'vod', id: '2' }] }] }
  });
  assert.ok(!/private-password|private-token|private-stream|1234/.test(JSON.stringify(safe)));
  assert.equal(safe.profiles.profiles[0].blockedTitles.length, 1);
  assert.throws(() => validateBackup({ version: 99 }), /inválido/);
  assert.throws(() => validateBackup(null), /inválido/);
});

test('XMLTV: parsing, gzip e limite após descompactação', async () => {
  const xml = '<tv><programme channel="news" start="20261020120000 +0000" stop="20261020130000 +0000"><title>Jornal &amp; notícias</title></programme></tv>';
  const now = Date.UTC(2026, 9, 20, 12, 30);
  const parsed = parseXmltv(xml, { now });
  assert.equal(selectNowNext(parsed.byChannel.news, now).now.title, 'Jornal & notícias');
  assert.equal(await decodeXmltvBuffer(gzipSync(xml)), xml);
  await assert.rejects(decodeXmltvBuffer(gzipSync(xml), 10), /limite/);
});
