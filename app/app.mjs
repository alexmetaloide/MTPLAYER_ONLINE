import { createState, activeFavorites, resetCatalogs } from './core/state.mjs';
import { saveSettings, saveFavorites, saveHistory, saveProfiles } from './core/storage.mjs';
import { isFavorite, toggleFavorite, migrateFavorites, sanitizeFavorite } from './core/favorites.mjs';
import { findHistoryEntry, updatePlaybackHistory, formatPlaybackTime, historyProgressPercent, migrateHistory, removeHistoryEntry, clearHistoryForAccount, hideFromContinue } from './core/history.mjs';
import { addProfile, defaultProfileId, ensureProfilesForAccounts, rememberedProfile, removeProfile, setRememberedProfile, updateProfile, profilesForAccount, migrateProfileState, exportableProfileState, playbackPreferences } from './core/profiles.mjs';
import { createProfilePin, hasProfilePin, verifyProfilePin } from './core/profile-pin.mjs';
import { filterCatalogForProfile, filterItemsForProfile, isRestrictedItem } from './core/parental-control.mjs';
import { root, modalRoot, qs, qsa, cloneTemplate, toast, closeModal, showLoadingModal, esc } from './ui/dom.mjs';
import { renderHome, updateHomeIndicators, updateHomeHub } from './ui/home.mjs';
import { renderSearchView } from './ui/search-view.mjs';
import { renderCatalogView, renderFavoritesView } from './ui/catalog-view.mjs';
import { renderDiscoverView } from './ui/discover-view.mjs';
import { buildDiscoverFeed } from './core/discover.mjs';
import { buildRecommendations } from './core/recommendations.mjs';
import { createInactivityGuard } from './core/inactivity.mjs';
import { openInactivityModal } from './ui/inactivity.mjs';
import { buildStreamingHub, similarTitles } from './core/streaming-hub.mjs';
import { buildRecentFeed, recentStorageKey } from './core/recent.mjs';
import { buildPreviewEditionIndex } from './core/preview-selection.mjs';
import { buildFeedCategories } from './core/feed-categories.mjs';
import { renderSettings } from './ui/settings.mjs';
import { renderEpgView } from './ui/epg-view.mjs';
import { renderHistoryView } from './ui/history-view.mjs';
import { renderProfilePicker, renderProfileManager, openProfileEditorModal, openProfilePinModal, openProfilePinSetupModal } from './ui/profiles.mjs';
import { openAccountModal, openBackupModal, openSupportModal, openEpisodeModal, openMovieModal, openNextEpisodeModal, openResumePlaybackModal, openTrackSelectionModal, openCatchupModal } from './ui/modals.mjs';
import { blockTitle, unblockTitle, isTitleBlocked } from './core/title-blocks.mjs';
import { openBlockedTitlesModal } from './ui/title-blocks.mjs';
import { openSpeedModal } from './ui/speed.mjs';
import { PlayerAdapter, PLAYBACK_RATES } from './player/player-adapter.mjs';
import { CinemaControls } from './player/cinema-controls.mjs';
import { initRemoteNavigation } from './ui/remote-navigation.mjs';
import { formatDateTime } from './core/utils.mjs';
import { createCatalogLoader } from './core/catalog-loader.mjs';

import { loadProfileRatings, updateRating, ratingValue, ratingStorageKey, exportRatings, importRatings } from './core/ratings.mjs';
const state = createState();
const inactivityGuard = createInactivityGuard();
let profileRatingCache = null;
let itemDetailsRequestVersion = 0;
function currentRatings() {
  const key = ratingStorageKey(state.activeAccount?.id, activeProfileId());
  if (profileRatingCache?.key !== key) profileRatingCache = { key, rows: loadProfileRatings(localStorage, state.activeAccount?.id, activeProfileId()) };
  return profileRatingCache.rows;
}
function handleRating(item, value) {
  if (!state.activeAccount) return;
  const rows = updateRating(currentRatings(), item, value);
  localStorage.setItem(profileRatingCache.key, JSON.stringify(rows));
  profileRatingCache.rows = rows;
  homeDerivedCache = null;
  toast(value === 0 ? 'Avaliação removida.' : 'Avaliação salva. Suas sugestões serão atualizadas.');
}
function detailOptions(item) {
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const isCurrent = () => accountId === state.activeAccount?.id && profileId === activeProfileId();
  const catalogs = { vod: visibleCatalog(state.catalogs.vod), series: visibleCatalog(state.catalogs.series) };
  return { ...ratingOptions(), onBlock: selected => {
      if (!isCurrent()) return;
      const profile = state.activeProfile;
      if (!profile) return;
      updateProfileBlocks(profile, selected, true);
      closeModal();
      const view = ['home', 'vod', 'series', 'favorites', 'search', 'discover', 'recent'].includes(state.lastView) ? state.lastView : 'home';
      navigate(view).catch(handleError);
      toast('Título bloqueado neste perfil. Gerencie em Perfis → Títulos bloqueados.');
    }, related: similarTitles(catalogs, item, { ratings: currentRatings() }),
    onRelated: selected => { if (isCurrent()) { closeModal(); openItem(selected).catch(handleError); } } };
}
function ratingOptions() {
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const current = () => state.activeAccount?.id === accountId && activeProfileId() === profileId;
  return { getRating: item => current() ? ratingValue(currentRatings(), item) : 0,
    onRate: (item, value) => { if (current()) handleRating(item, value); } };
}
const player = new PlayerAdapter();
const catalogLoader = createCatalogLoader({
  getAccountId: () => catalogAccountTransition ? null : state.activeAccount?.id,
  load: (kind, options) => window.desktopAPI.catalog.get(kind, options),
  onCatalog: acceptCatalog
});
let catalogSessionVersion = 0;
let catalogAccountTransition = false;
let previousView = 'home';
let playbackTimer = null;
let progressUiTimer = null;
let progressHideTimer = null;
let activePlayback = null;
let currentPlayerItem = null;
let currentPlayerVideo = null;
let cinemaControls = null;
let playerSessionVersion = 0;
let livePanelSelectedIndex = -1;
let livePanelStart = 0;
let liveRecoverySelectedIndex = 0;
let preservedSeriesCatalogView = null;
let channelSwitchPending = false;
let lastSeekKeyAt = 0;
let currentSeriesContext = null;
let playbackEndedHandled = false;
let creditsPromptShown = false;
let liveReconnectTimer = null;
let liveReconnectStableTimer = null;
let liveStallTimer = null;
let liveStallCleanup = null;
let liveReconnectAttempts = 0;
let liveZapHideTimer = null;
let liveEpgRequestVersion = 0;
const liveEpgCache = new Map();
const livePlaybackCache = new Map();
const vodDetailsCache = new Map();
const seriesEpisodesCache = new Map();
const vodDetailsRequests = new Map();
const seriesEpisodesRequests = new Map();
let discoverController = null;
let homeRecommendationsRequest = null;
const previewEditionCaches = new Map();
const profileFilteredCatalogs = new WeakMap();
let homeDerivedCache = null;
let homeFavoritesRevision = 0;
let homeRenderScheduled = false;
const SEEK_STEP_SECONDS = 30;
const SEEK_REPEAT_MS = 120;
const LIVE_RECONNECT_DELAYS = [1000, 2000, 4000, 8000];
const LIVE_EPG_TTL_MS = 60000;
const LIVE_EPG_CACHE_LIMIT = 120;
const LIVE_PLAYBACK_CACHE_LIMIT = 24;
const VOD_DETAILS_CACHE_LIMIT = 48;
const SERIES_EPISODES_CACHE_LIMIT = 16;
const profilePinFailures = new Map();
const PROFILE_PIN_MAX_ATTEMPTS = 5;
const PROFILE_PIN_LOCK_MS = 30000;
const parentalUnlockUntil = new Map();
const PARENTAL_UNLOCK_MS = 10 * 60 * 1000;

function invalidateCatalogSession() {
  catalogSessionVersion += 1;
  catalogLoader.invalidate();
  previewEditionCaches.clear();
  homeDerivedCache = null;
  homeRecommendationsRequest = null;
}

function resetLoadedCatalogs() {
  invalidateCatalogSession();
  resetCatalogs(state);
}

async function changeAccount(action) {
  if (catalogAccountTransition) return false;
  catalogAccountTransition = true;
  invalidateCatalogSession();
  try {
    await action();
    await reloadAccounts();
    resetLoadedCatalogs();
    return true;
  } finally {
    catalogAccountTransition = false;
  }
}

function isSeekableKind(kind) {
  return ['vod', 'series', 'catchup'].includes(kind);
}

function shouldPersistPlayback(kind) {
  return ['vod', 'series'].includes(kind);
}

function disposeCinemaControls() {
  cinemaControls?.destroy();
  cinemaControls = null;
}

function beginPlayerSession({ preserveControls = false } = {}) {
  if (!preserveControls) disposeCinemaControls();
  playerSessionVersion += 1;
  return playerSessionVersion;
}

function invalidatePlayerSession() {
  disposeCinemaControls();
  playerSessionVersion += 1;
}

function isPlayerSessionCurrent(version) {
  return version === playerSessionVersion;
}

function isPlayerSessionMatch(version, item, video = null) {
  if (!isPlayerSessionCurrent(version) || state.lastView !== 'player') return false;
  if (!currentPlayerItem || currentPlayerItem.kind !== item?.kind || String(currentPlayerItem.id) !== String(item?.id)) return false;
  return !video || currentPlayerVideo === video;
}

function livePanelWindowSize() {
  return innerHeight < 900 ? 7 : 10;
}

async function report(level, message) {
  try { await window.desktopAPI.log(level, String(message)); } catch {}
}

function deriveHomeContent() {
  const accountId = state.activeAccount?.id || '';
  const profileId = activeProfileId();
  const scope = `${accountId}:${profileId}`;
  const kidsMode = Boolean(state.activeProfile?.kidsMode);
  if (!homeDerivedCache || homeDerivedCache.scope !== scope || homeDerivedCache.kidsMode !== kidsMode
      || homeDerivedCache.vod !== state.catalogs.vod || homeDerivedCache.series !== state.catalogs.series
      || homeDerivedCache.historySource !== state.history || homeDerivedCache.favorites !== state.favorites
      || homeDerivedCache.favoritesRevision !== homeFavoritesRevision) {
    const history = visibleHistory();
    const catalogs = { vod: visibleCatalog(state.catalogs.vod), series: visibleCatalog(state.catalogs.series) };
    homeDerivedCache = {
      scope, kidsMode, vod: state.catalogs.vod, series: state.catalogs.series,
      historySource: state.history, favorites: state.favorites, favoritesRevision: homeFavoritesRevision,
      history,
      recommendations: buildRecommendations(catalogs, {
        history, favorites: state.favorites, accountId, profileId, ratings: currentRatings()
      }),
      streamingHub: buildStreamingHub(catalogs, {
        history, favorites: state.favorites, accountId, profileId
      })
    };
  }
  return homeDerivedCache;
}

function handleHomeFavorite(item) {
  const added = toggleFavoriteTracked(item);
  saveFavorites(state.favorites);
  const { streamingHub } = deriveHomeContent();
  updateHomeHub(streamingHub, {
    onHubOpen: openHubItem,
    onHubFavorite: handleHomeFavorite,
    isInList: item => isFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId())
  });
  toast(added ? 'Adicionado à Minha lista.' : 'Removido de Minha lista.');
}

function openHubItem(item) {
  openItem(item).catch(handleError);
}

function renderHomeView() {
  disposeDiscover();
  if (isTvDevice() && !state.activeAccount) return openAccounts();
  if (state.activeAccount && !state.activeProfile) return openProfiles();
  document.body.classList.remove('account-login');
  document.body.classList.remove('profile-selection');
  state.lastView = 'home';
  const { scope, history, recommendations, streamingHub } = deriveHomeContent();
  renderHome({ ...state, history, recommendations, streamingHub,
    recommendationsError: homeRecommendationsRequest?.scope === scope && homeRecommendationsRequest.failed
  }, {
    onContinue: entry => resumeContinueEntry(entry).catch(handleError),
    onContinueRemove: entry => {
      state.history = hideFromContinue(state.history, entry);
      saveHistory(state.history);
      renderHomeView();
      toast('Removido da faixa. O histórico foi preservado.');
    },
    onRecommendation: item => openItem(item).catch(handleError),
    onHubOpen: openHubItem,
    isInList: item => isFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId()),
    onHubFavorite: handleHomeFavorite
  });
  if (state.activeAccount
      && (!state.catalogs.vod.loaded || !state.catalogs.series.loaded)) {
    if (homeRecommendationsRequest?.scope !== scope) {
      const missing = ['vod', 'series'].filter(kind => !state.catalogs[kind].loaded);
      homeRecommendationsRequest = { scope };
      Promise.allSettled(missing.map(kind => ensureCatalog(kind, { quiet: true }))).then(results => {
        if (homeRecommendationsRequest?.scope === scope) {
          homeRecommendationsRequest.failed = results.every(result => result.status === 'rejected');
        }
        results.forEach((result, index) => {
          if (result.status === 'rejected') report('warn', `Sugestões (${missing[index]}): ${result.reason?.message || result.reason}`);
        });
        if (state.lastView === 'home' && `${state.activeAccount?.id}:${activeProfileId()}` === scope) scheduleHomeRender();
      });
    }
  }
}

function scheduleHomeRender() {
  if (homeRenderScheduled || state.lastView !== 'home') return;
  homeRenderScheduled = true;
  requestAnimationFrame(() => {
    homeRenderScheduled = false;
    if (state.lastView === 'home') renderHomeView();
  });
}

function toggleFavoriteTracked(item) {
  const added = toggleFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId());
  homeFavoritesRevision += 1;
  return added;
}

function disposeDiscover() {
  if (!discoverController) return;
  discoverController.destroy();
  discoverController = null;
}

function setDiscoverFullscreen(enabled) {
  if (window.desktopAPI?.windowControls?.setDiscoverFullscreen) {
    window.desktopAPI.windowControls.setDiscoverFullscreen(enabled).catch(handleError);
  } else if (!isTvDevice()) {
    if (enabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!enabled && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }
}

function isSamsungTv() {
  return document.documentElement.classList.contains('tizen-tv');
}

function isTvDevice() {
  return isSamsungTv() || document.documentElement.classList.contains('android-tv');
}

function isDesktopPlayer() {
  return !isSamsungTv() && !globalThis.AndroidBridge;
}

function bindCinemaControls(item, video) {
  if (!isDesktopPlayer() || isTvDevice() || item.kind === 'radio') return;
  const session = playerSessionVersion;
  cinemaControls = new CinemaControls({
    root: qs('.player-view'), video, player, item,
    getEpisodes: () => currentSeriesContext?.episodes || [],
    onEpisode: episode => {
      if (!isPlayerSessionMatch(session, item, video)) return;
      const context = currentSeriesContext;
      const index = context?.episodes?.findIndex(row => String(row.id) === String(episode.id)) ?? -1;
      if (index < 0) return;
      return requestPlayback(episode, { preservePreviousView: true, seriesContext: { ...context, index } });
    },
    onChannels: () => liveChannelPanelOpen() ? hideLiveChannelPanel() : showLiveChannelPanel(),
    onPrevious: () => switchLiveChannel(-1),
    onNext: () => switchLiveChannel(1),
    onError: handleError
  });
}

function bindDesktopPlayerControls(item) {
  if (!isDesktopPlayer()) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'desktop-player-actions';
  toolbar.setAttribute('aria-label', 'Controles de reprodução');
  toolbar.innerHTML = item.kind === 'live'
    ? '<button data-player-command="previous" title="Canal anterior (Page Up)">← Canal</button><button data-player-command="channels" title="Lista de canais (Enter)">Canais</button><button data-player-command="next" title="Próximo canal (Page Down)">Canal →</button>'
    : isSeekableKind(item.kind)
      ? '<button data-player-command="tracks" title="Áudio e legendas (↑)">Áudio / legendas</button>'
      : '';
  qs('.player-top').append(toolbar);
  qs('#live-channel-list').addEventListener('wheel', event => {
    if (!liveChannelPanelOpen() || !event.deltaY) return;
    event.preventDefault();
    moveLivePanelSelection(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  qs('.player-view').addEventListener('click', event => {
    const recovery = event.target.closest('[data-live-recovery]');
    if (recovery) {
      runLiveRecoveryAction(recovery.dataset.liveRecovery).catch(handleError);
      return;
    }
    const channel = event.target.closest('[data-live-index]');
    if (channel) {
      const index = Number(channel.dataset.liveIndex);
      if (!Number.isInteger(index) || index < 0) return;
      if (event.target.closest('.live-channel-favorite')) {
        livePanelSelectedIndex = index;
        toggleLivePanelFavorite();
      } else switchLiveChannel(0, index).catch(handleError);
      return;
    }
    const command = event.target.closest('[data-player-command]')?.dataset.playerCommand;
    if (command === 'previous' || command === 'next') switchLiveChannel(command === 'next' ? 1 : -1).catch(handleError);
    if (command === 'channels') {
      if (liveChannelPanelOpen()) hideLiveChannelPanel();
      else showLiveChannelPanel().catch(handleError);
    }
    if (command === 'tracks') openPlayerTrackMenu().catch(handleError);
  });
}

function activeProfileId() {
  return state.activeProfile?.id || '';
}

function itemCategories(item) {
  return state.catalogs[item?.kind]?.categories || [];
}

function isRestrictedForActiveProfile(item) {
  return isRestrictedItem(item, itemCategories(item));
}

function visibleCatalog(catalog) {
  const profile = state.activeProfile;
  if ((!profile?.kidsMode && !profile?.blockedTitles?.length) || !catalog || typeof catalog !== 'object') return catalog;
  let cache = profileFilteredCatalogs.get(catalog);
  if (!cache) { cache = new WeakMap(); profileFilteredCatalogs.set(catalog, cache); }
  if (!cache.has(profile)) cache.set(profile, filterCatalogForProfile(catalog, profile));
  return cache.get(profile);
}

function visibleItems(items, kind = '') {
  if (kind) return filterItemsForProfile(items, state.activeProfile, state.catalogs[kind]?.categories || []);
  return (Array.isArray(items) ? items : []).filter(item => !isTitleBlocked(state.activeProfile, item)
    && (!state.activeProfile?.kidsMode || !isRestrictedItem(item, itemCategories(item))));
}

function visibleHistory() {
  return state.history.filter(entry => !isTitleBlocked(state.activeProfile, entry.item)
    && (!state.activeProfile?.kidsMode || !isRestrictedItem(entry.item, itemCategories(entry.item))));
}

function migrateLegacyProfileData() {
  let favoritesChanged = false;
  let historyChanged = false;
  state.favorites = migrateFavorites(state.favorites.map(item => {
    if (item.profileId) return item;
    favoritesChanged = true;
    return sanitizeFavorite(item, item.accountId || state.activeAccount?.id || '', defaultProfileId(item.accountId || state.activeAccount?.id || ''));
  }));
  state.history = migrateHistory(state.history.map(entry => {
    if (entry.profileId) return entry;
    historyChanged = true;
    return { ...entry, profileId: defaultProfileId(entry.accountId) };
  }));
  if (favoritesChanged) saveFavorites(state.favorites);
  if (historyChanged) saveHistory(state.history);
}

function syncProfilesForAccounts() {
  state.profileState = ensureProfilesForAccounts(state.profileState, state.accounts);
  saveProfiles(state.profileState);
  migrateLegacyProfileData();
  if (state.activeProfile) {
    const valid = profilesForAccount(state.profileState, state.activeAccount?.id)
      .find(profile => profile.id === state.activeProfile.id);
    state.activeProfile = valid || null;
  }
}

function catalogPageSize() {
  return isTvDevice() ? Math.min(state.settings.pageSize, 24) : state.settings.pageSize;
}

function contentCacheKey(item) {
  return `${state.activeAccount?.id || ''}:${item?.id || item?.sourceId || item?.name || ''}`;
}

function rememberContentCache(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

function readLruCache(cache, key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function clearContentDetailCaches() {
  vodDetailsCache.clear();
  seriesEpisodesCache.clear();
  vodDetailsRequests.clear();
  seriesEpisodesRequests.clear();
}

function clearPreservedSeriesCatalogView() {
  preservedSeriesCatalogView = null;
}

function preserveSeriesCatalogView() {
  if (state.lastView !== 'series' || !state.activeAccount) return false;
  const view = root.firstElementChild;
  if (!view?.classList?.contains('content-view')) return false;
  preservedSeriesCatalogView = {
    accountId: String(state.activeAccount.id || ''),
    view
  };
  return true;
}

function restorePreservedSeriesCatalogView() {
  const snapshot = preservedSeriesCatalogView;
  if (!snapshot?.view || !state.activeAccount) return false;
  if (snapshot.accountId !== String(state.activeAccount.id || '')) {
    clearPreservedSeriesCatalogView();
    return false;
  }
  root.replaceChildren(snapshot.view);
  return true;
}

async function getVodDetailsCached(item) {
  if (!window.desktopAPI.catalog.details) return item;
  const key = contentCacheKey(item);
  const cached = readLruCache(vodDetailsCache, key);
  if (cached) return cached;
  if (vodDetailsRequests.has(key)) return vodDetailsRequests.get(key);

  const request = window.desktopAPI.catalog.details(item)
    .then(details => rememberContentCache(vodDetailsCache, key, details || item, VOD_DETAILS_CACHE_LIMIT))
    .finally(() => vodDetailsRequests.delete(key));
  vodDetailsRequests.set(key, request);
  return request;
}

async function getSeriesEpisodesCached(item) {
  const key = contentCacheKey(item);
  const cached = readLruCache(seriesEpisodesCache, key);
  if (cached) return cached;
  if (seriesEpisodesRequests.has(key)) return seriesEpisodesRequests.get(key);

  const request = window.desktopAPI.catalog.episodes(item)
    .then(episodes => orderedEpisodes(episodes || []))
    .then(episodes => rememberContentCache(seriesEpisodesCache, key, episodes, SERIES_EPISODES_CACHE_LIMIT))
    .finally(() => seriesEpisodesRequests.delete(key));
  seriesEpisodesRequests.set(key, request);
  return request;
}

function renderHistory() {
  if (!state.activeAccount) return openAccounts();
  renderHistoryView({ ...state, history: visibleHistory() }, {
    onOpen: entry => requestPlayback(entry.item).catch(handleError),
    onRestart: entry => {
      state.history = removeHistoryEntry(state.history, entry.key);
      saveHistory(state.history);
      openPlayer(entry.item).catch(handleError);
    },
    onRemove: entry => {
      state.history = removeHistoryEntry(state.history, entry.key);
      saveHistory(state.history);
      renderHistory();
      toast('Item removido do histórico.');
    },
    onClear: () => {
      state.history = clearHistoryForAccount(state.history, state.activeAccount.id, activeProfileId());
      saveHistory(state.history);
      renderHistory();
      toast('Histórico deste perfil foi limpo.');
    }
  });
}

async function persistPlaybackProgress() {
  if (!activePlayback || !state.activeAccount) return;
  try {
    const progress = await player.progress(activePlayback.video);
    if (!activePlayback.persist) return progress;
    state.history = updatePlaybackHistory(
      state.history,
      activePlayback.item,
      state.activeAccount.id,
      progress,
      Date.now(),
      activeProfileId()
    );
    saveHistory(state.history);
    return progress;
  } catch (error) {
    report('warn', `Falha ao salvar progresso: ${error?.message || error}`);
    return null;
  }
}

async function stopPlaybackTracking() {
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = null;
  if (progressUiTimer) clearInterval(progressUiTimer);
  progressUiTimer = null;
  if (progressHideTimer) clearTimeout(progressHideTimer);
  progressHideTimer = null;
  if (activePlayback?.endedHandler) {
    activePlayback.video?.removeEventListener('ended', activePlayback.endedHandler);
    window.removeEventListener('metalloide:playback-ended', activePlayback.endedHandler);
  }
  if (activePlayback) await persistPlaybackProgress();
  activePlayback = null;
}

async function updatePlayerProgress() {
  if (!activePlayback || !isSeekableKind(activePlayback.item.kind)) return;
  const container = document.getElementById('player-progress');
  if (!container?.isConnected) return;
  try {
    const progress = await player.progress(activePlayback.video);
    const position = Math.max(0, Number(progress.position) || 0);
    const duration = Math.max(0, Number(progress.duration) || 0);
    const percent = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
    const fill = document.getElementById('player-progress-fill');
    const current = document.getElementById('player-progress-current');
    const total = document.getElementById('player-progress-duration');
    const stateIcon = document.getElementById('player-control-state');
    const title = document.getElementById('player-control-title');
    if (fill) fill.style.width = `${percent}%`;
    if (current) current.textContent = formatPlaybackTime(position);
    if (total) total.textContent = duration > 0 ? formatPlaybackTime(duration) : '—:—';
    if (stateIcon) stateIcon.textContent = progress.paused ? '▶' : '❚❚';
    if (title) title.textContent = currentPlayerItem?.name || 'Reprodução';
  } catch {}
}

function hidePlayerProgress() {
  if (progressUiTimer) clearInterval(progressUiTimer);
  progressUiTimer = null;
  if (progressHideTimer) clearTimeout(progressHideTimer);
  progressHideTimer = null;
  const container = document.getElementById('player-progress');
  container?.classList.add('hidden');
  container?.setAttribute('aria-hidden', 'true');
}

async function showPlayerProgress({ autoHide = true } = {}) {
  if (cinemaControls) { cinemaControls.show(); return cinemaControls.refresh(); }
  if (!isSeekableKind(currentPlayerItem?.kind)) return;
  const container = document.getElementById('player-progress');
  if (!container) return;
  container.classList.remove('hidden');
  container.setAttribute('aria-hidden', 'false');
  await updatePlayerProgress();
  if (!progressUiTimer) progressUiTimer = setInterval(() => updatePlayerProgress(), 500);
  if (progressHideTimer) clearTimeout(progressHideTimer);
  progressHideTimer = autoHide ? setTimeout(() => hidePlayerProgress(), 3200) : null;
}

async function seekCurrentVideo(deltaSeconds) {
  if (!isSeekableKind(currentPlayerItem?.kind) || !currentPlayerVideo) return;
  const progress = await player.progress(currentPlayerVideo);
  const duration = Math.max(0, Number(progress.duration) || 0);
  const position = Math.max(0, Number(progress.position) || 0);
  const target = duration > 0
    ? Math.min(Math.max(0, duration - 1), Math.max(0, position + deltaSeconds))
    : Math.max(0, position + deltaSeconds);
  await player.seek(currentPlayerVideo, target);
  await showPlayerProgress();
  persistPlaybackProgress().catch(() => {});
}

async function toggleCurrentVideoPlayback() {
  if (!isSeekableKind(currentPlayerItem?.kind) || !currentPlayerVideo) return;
  await player.togglePlayback(currentPlayerVideo);
  await showPlayerProgress();
}

async function setCurrentPlaybackState(action) {
  if (!currentPlayerItem || !currentPlayerVideo) return;
  if (action === 'pause') await player.pausePlayback(currentPlayerVideo);
  else if (action === 'play') await player.resumePlayback(currentPlayerVideo);
  else await player.togglePlayback(currentPlayerVideo);
  if (isSeekableKind(currentPlayerItem.kind)) await showPlayerProgress();
}

async function openPlayerTrackMenu() {
  if (!isSeekableKind(currentPlayerItem?.kind) || !currentPlayerVideo) return;
  const tracks = await player.tracks(currentPlayerVideo);
  const audio = Array.isArray(tracks?.audio) ? tracks.audio : [];
  const subtitles = Array.isArray(tracks?.subtitles) ? tracks.subtitles : [];
  if (!audio.length && !subtitles.length) return toast('Este conteúdo não oferece outras faixas de áudio ou legenda.');
  openTrackSelectionModal({ audio, subtitles }, {
    onAudio: async id => {
      await player.selectTrack('audio', id, currentPlayerVideo);
      toast('Faixa de áudio alterada.');
    },
    onSubtitle: async id => {
      await player.selectTrack('subtitle', id, currentPlayerVideo);
      toast(id < 0 ? 'Legendas desligadas.' : 'Legenda alterada.');
    }
  });
}

function syncPlayerSpeedButton() {
  const button = document.getElementById('player-speed');
  if (!button) return;
  const supported = ['vod', 'series'].includes(currentPlayerItem?.kind) && player.supportsPlaybackRate(currentPlayerVideo);
  button.disabled = !supported;
  button.title = supported ? 'Alterar velocidade de reprodução' : 'Velocidade indisponível neste player';
  const rate = supported ? currentPlayerVideo.playbackRate : 1;
  button.textContent = `Velocidade ${Number(rate).toLocaleString('pt-BR')}×`;
}

function openPlayerSpeedMenu() {
  const item = currentPlayerItem;
  const video = currentPlayerVideo;
  if (!['vod', 'series'].includes(item?.kind) || !player.supportsPlaybackRate(video)) return;
  const session = playerSessionVersion;
  const isCurrent = () => isPlayerSessionMatch(session, item, video);
  openSpeedModal({ rates: PLAYBACK_RATES, current: video.playbackRate, isCurrent,
    onSelect: async rate => {
      if (!isCurrent()) return;
      await player.setPlaybackRate(video, rate);
      if (isCurrent()) syncPlayerSpeedButton();
    } });
}

function updateHomeSummaryUi() {
  if (state.lastView !== 'home') return;
  const live = document.getElementById('live-count');
  const vod = document.getElementById('vod-count');
  const series = document.getElementById('series-count');
  const radio = document.getElementById('radio-count');
  if (live) live.textContent = `${state.summary.live || 0} canais`;
  if (vod) vod.textContent = `${state.summary.vod || 0} títulos`;
  if (series) series.textContent = `${state.summary.series || 0} séries`;
  if (radio) radio.textContent = `${state.summary.radio || 0} estações`;
}

function offerNextEpisode(item, nextEpisode, currentIndex, mode) {
  const session = playerSessionVersion;
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const context = currentSeriesContext;
  const isCurrent = () => session === playerSessionVersion && state.lastView === 'player'
    && state.activeAccount?.id === accountId && activeProfileId() === profileId
    && currentPlayerItem?.kind === item.kind && String(currentPlayerItem?.id) === String(item.id);
  const start = (episode, { automatic = false } = {}) => {
    if (!isCurrent()) return;
    return openPlayer(episode, { preservePreviousView: true, automaticEpisode: automatic,
      seriesContext: { ...context, index: currentIndex + 1 } }).catch(handleError);
  };
  const preferences = playbackPreferences(state.activeProfile);
  if (nextEpisode && mode === 'ended' && preferences.nextEpisodeAutoplay && preferences.inactivityCheck && inactivityGuard.shouldAsk()) {
    openInactivityModal({ isCurrent, onContinue: () => { inactivityGuard.interact(); start(nextEpisode); } });
    return;
  }
  openNextEpisodeModal(item, nextEpisode, { mode, isCurrent, autoplay: preferences.nextEpisodeAutoplay, onNext: start });
}

async function handlePlaybackEnded(item) {
  if (playbackEndedHandled || !item || currentPlayerItem?.kind !== item.kind || String(currentPlayerItem?.id) !== String(item.id)) return;
  const session = playerSessionVersion;
  playbackEndedHandled = true;
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = null;
  await persistPlaybackProgress();
  if (session !== playerSessionVersion || state.lastView !== 'player') return;
  hidePlayerProgress();
  if (item.kind !== 'series' || !currentSeriesContext?.episodes?.length) return;
  inactivityGuard.finish(session);
  const episodes = currentSeriesContext.episodes;
  const currentIndex = episodes.findIndex(episode => String(episode.id) === String(item.id));
  if (currentIndex < 0) return;
  offerNextEpisode(item, episodes[currentIndex + 1] || null, currentIndex, 'ended');
}

function maybeShowCreditsPrompt(item, progress) {
  if (creditsPromptShown || playbackEndedHandled || item?.kind !== 'series') return;
  if (!currentSeriesContext?.episodes?.length || modalRoot.childElementCount) return;
  const duration = Math.max(0, Number(progress?.duration) || 0);
  const position = Math.max(0, Number(progress?.position) || 0);
  if (!duration || position <= 0) return;
  const remaining = duration - position;
  const promptSeconds = [60, 90, 120].includes(Number(state.settings.nextEpisodeSeconds)) ? Number(state.settings.nextEpisodeSeconds) : 90;
  if (remaining <= 0 || remaining > promptSeconds) return;
  const episodes = currentSeriesContext.episodes;
  const currentIndex = episodes.findIndex(episode => String(episode.id) === String(item.id));
  const nextEpisode = currentIndex >= 0 ? episodes[currentIndex + 1] : null;
  if (!nextEpisode) return;
  creditsPromptShown = true;
  // Without provider markers we cannot identify credits. Offer a manual action
  // near the end; start an automatic countdown only after the episode ends.
  offerNextEpisode(item, nextEpisode, currentIndex, 'credits');
}

function startPlaybackTracking(item, video) {
  if (!isSeekableKind(item.kind) || !state.activeAccount) return;
  const endedHandler = () => handlePlaybackEnded(item).catch(handleError);
  const series = item.kind === 'series' ? currentSeriesContext?.series : null;
  const historyItem = series ? {
    ...item, seriesId: String(series.id || ''), seriesName: series.name || '',
    genre: series.genre || item.genre || ''
  } : item;
  activePlayback = { item: historyItem, video, endedHandler, persist: shouldPersistPlayback(item.kind) };
  playbackTimer = setInterval(async () => {
    const progress = await persistPlaybackProgress();
    if (progress?.ended) endedHandler();
    else maybeShowCreditsPrompt(item, progress);
  }, 5000);
  video?.addEventListener('ended', endedHandler, { once: true });
  window.addEventListener('metalloide:playback-ended', endedHandler, { once: true });
}

function episodeNumber(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function orderedEpisodes(episodes) {
  return [...(episodes || [])].sort((a, b) =>
    episodeNumber(a.season) - episodeNumber(b.season)
    || episodeNumber(a.episode) - episodeNumber(b.episode)
    || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
  );
}

function liveChannels() {
  return visibleItems(state.catalogs.live?.items || [], 'live');
}

function livePlaybackKey(item) {
  return `${state.activeAccount?.id || ''}:${state.settings.streamType}:${item?.id || ''}`;
}

async function getLivePlayback(item) {
  const key = livePlaybackKey(item);
  if (!key || key.endsWith(':')) return window.desktopAPI.playback.get(item, state.settings.streamType);
  const cached = readLruCache(livePlaybackCache, key);
  if (cached) return cached;
  if (!livePlaybackCache.has(key)) {
    const request = Promise.resolve(window.desktopAPI.playback.get(item, state.settings.streamType)).catch(error => {
      livePlaybackCache.delete(key);
      throw error;
    });
    rememberContentCache(livePlaybackCache, key, request, LIVE_PLAYBACK_CACHE_LIMIT);
  }
  return livePlaybackCache.get(key);
}

function primeNearbyLivePlayback(items, index) {
  for (const offset of [-2, -1, 1, 2]) {
    const target = items[(index + offset + items.length) % items.length];
    if (target) getLivePlayback(target).catch(() => {});
  }
}

function liveEpgKey(value) {
  const id = typeof value === 'object' ? value?.id : value;
  return `${state.activeAccount?.id || ''}:${String(id || '')}`;
}

function cachedLiveEpg(channel) {
  const key = liveEpgKey(channel);
  const cached = readLruCache(liveEpgCache, key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    liveEpgCache.delete(key);
    return null;
  }
  return cached.row;
}

async function loadLiveEpg(channels) {
  const unresolved = (channels || []).filter(channel => !cachedLiveEpg(channel));
  if (unresolved.length) {
    const rows = await window.desktopAPI.epg.getMany(unresolved.map(channel => ({
      id: channel.id,
      tvgId: channel.tvgId || '',
      name: channel.name || ''
    })));
    const expiresAt = Date.now() + LIVE_EPG_TTL_MS;
    for (const row of rows || []) rememberContentCache(liveEpgCache, liveEpgKey(row.streamId), { row, expiresAt }, LIVE_EPG_CACHE_LIMIT);
    for (const channel of unresolved) {
      const id = String(channel.id);
      const key = liveEpgKey(id);
      if (!liveEpgCache.has(key)) rememberContentCache(liveEpgCache, key, { row: { streamId: id, now: null, next: null }, expiresAt }, LIVE_EPG_CACHE_LIMIT);
    }
  }
  return (channels || []).map(channel => cachedLiveEpg(channel));
}

function liveProgramPercent(program) {
  const start = Number(program?.start) || 0;
  const end = Number(program?.end) || 0;
  if (!start || !end || end <= start) return 0;
  return Math.min(100, Math.max(0, Math.round((Date.now() - start) / (end - start) * 100)));
}

function liveProgramTime(program) {
  if (!program?.start) return '';
  const start = formatDateTime(program.start);
  const end = program.end ? formatDateTime(program.end) : '';
  return end ? `${start}–${end}` : start;
}

function showLiveZapOverlay(item, epg = null) {
  const overlay = document.getElementById('live-zap-overlay');
  if (!overlay || item?.kind !== 'live') return;
  const logo = document.getElementById('live-zap-logo');
  const name = document.getElementById('live-zap-name');
  const now = document.getElementById('live-zap-now');
  const next = document.getElementById('live-zap-next');
  const fill = document.getElementById('live-zap-progress-fill');
  if (logo) {
    logo.src = item.image || '';
    logo.classList.toggle('hidden', !item.image);
  }
  if (name) name.textContent = item.name || 'Canal';
  if (now) now.textContent = epg?.now
    ? `Agora • ${liveProgramTime(epg.now)} • ${epg.now.title || 'Programação'}`
    : 'Agora • carregando programação…';
  if (next) next.textContent = epg?.next
    ? `Próximo • ${liveProgramTime(epg.next)} • ${epg.next.title || 'Programação'}`
    : '';
  if (fill) fill.style.width = `${liveProgramPercent(epg?.now)}%`;
  overlay.classList.remove('hidden');
  if (liveZapHideTimer) clearTimeout(liveZapHideTimer);
  liveZapHideTimer = setTimeout(() => overlay.classList.add('hidden'), 4500);
}

async function hydrateLiveZapOverlay(item) {
  const [row] = await loadLiveEpg([item]);
  if (currentPlayerItem?.kind === 'live' && String(currentPlayerItem.id) === String(item.id)) showLiveZapOverlay(item, row);
  return row;
}

function cancelLiveReconnect({ resetAttempts = true } = {}) {
  if (liveReconnectTimer) clearTimeout(liveReconnectTimer);
  if (liveReconnectStableTimer) clearTimeout(liveReconnectStableTimer);
  if (liveStallTimer) clearTimeout(liveStallTimer);
  liveReconnectTimer = null;
  liveReconnectStableTimer = null;
  liveStallTimer = null;
  if (resetAttempts) liveReconnectAttempts = 0;
}

function clearLiveWebStallWatch() {
  if (liveStallCleanup) liveStallCleanup();
  liveStallCleanup = null;
  if (liveStallTimer) clearTimeout(liveStallTimer);
  liveStallTimer = null;
}

function markLivePlaybackStable() {
  if (liveReconnectStableTimer) clearTimeout(liveReconnectStableTimer);
  liveReconnectStableTimer = setTimeout(() => {
    liveReconnectStableTimer = null;
    liveReconnectAttempts = 0;
  }, 30000);
}

function liveRecoveryOpen() {
  const recovery = document.getElementById('player-recovery');
  return Boolean(recovery && !recovery.classList.contains('hidden'));
}

function focusLiveRecoveryAction(index = liveRecoverySelectedIndex) {
  const recovery = document.getElementById('player-recovery');
  if (!recovery) return;
  const actions = Array.from(recovery.querySelectorAll('[data-live-recovery]'));
  if (!actions.length) return;
  liveRecoverySelectedIndex = (index + actions.length) % actions.length;
  actions.forEach((button, buttonIndex) => button.classList.toggle('selected', buttonIndex === liveRecoverySelectedIndex));
  const selected = actions[liveRecoverySelectedIndex];
  try { selected.focus({ preventScroll: true }); } catch { selected.focus(); }
}

function hideLiveRecovery() {
  const recovery = document.getElementById('player-recovery');
  if (recovery) recovery.classList.add('hidden');
  liveRecoverySelectedIndex = 0;
}

function showLiveRecovery(reason = '') {
  const recovery = document.getElementById('player-recovery');
  const detail = document.getElementById('player-recovery-message');
  const message = document.getElementById('player-message');
  if (!recovery) return;
  if (message) message.classList.add('hidden');
  if (detail) detail.textContent = reason
    ? `Não foi possível reconectar ao canal. ${reason}`
    : 'Não foi possível reconectar ao canal automaticamente.';
  recovery.classList.remove('hidden');
  liveRecoverySelectedIndex = 0;
  focusLiveRecoveryAction(0);
}

async function runLiveRecoveryAction(action) {
  if (!currentPlayerItem || currentPlayerItem.kind !== 'live') return;
  if (action === 'retry') {
    const item = currentPlayerItem;
    hideLiveRecovery();
    cancelLiveReconnect();
    await openPlayer(item, { preservePreviousView: true });
    return;
  }
  if (action === 'next') {
    hideLiveRecovery();
    cancelLiveReconnect();
    await switchLiveChannel(1);
    return;
  }
  if (action === 'back') {
    hideLiveRecovery();
    cancelLiveReconnect();
    await navigate(previousView || 'live');
  }
}

function scheduleLiveReconnect(reason = '') {
  if (state.lastView !== 'player' || currentPlayerItem?.kind !== 'live' || liveReconnectTimer) return false;
  if (liveReconnectStableTimer) clearTimeout(liveReconnectStableTimer);
  if (liveStallTimer) clearTimeout(liveStallTimer);
  liveReconnectStableTimer = null;
  liveStallTimer = null;
  const message = document.getElementById('player-message');
  if (liveReconnectAttempts >= LIVE_RECONNECT_DELAYS.length) {
    showLiveRecovery(reason || 'A transmissão caiu.');
    report('warn', `Reconexão ao vivo esgotada: ${reason || 'falha de reprodução'}`);
    return false;
  }

  const item = currentPlayerItem;
  const attempt = liveReconnectAttempts + 1;
  const delay = LIVE_RECONNECT_DELAYS[liveReconnectAttempts];
  liveReconnectAttempts = attempt;
  if (message) {
    message.textContent = `Reconectando transmissão… tentativa ${attempt}/${LIVE_RECONNECT_DELAYS.length}`;
    message.classList.remove('hidden');
  }
  report('warn', `Reconectando canal ${item?.id || ''} em ${delay}ms (${reason || 'falha'}).`);
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    if (state.lastView !== 'player' || currentPlayerItem?.kind !== 'live' || String(currentPlayerItem.id) !== String(item?.id)) return;
    openPlayer(item, { preservePreviousView: true, reconnecting: true }).catch(handleError);
  }, delay);
  return true;
}

function watchLiveWebStalls(video) {
  if (!video) return;
  clearLiveWebStallWatch();
  const clearStall = () => {
    if (liveStallTimer) clearTimeout(liveStallTimer);
    liveStallTimer = null;
  };
  const armStall = () => {
    clearStall();
    liveStallTimer = setTimeout(() => {
      liveStallTimer = null;
      if (state.lastView === 'player' && currentPlayerItem?.kind === 'live' && currentPlayerVideo === video && !video.paused && video.readyState < 3) {
        scheduleLiveReconnect('transmissão travada');
      }
    }, 8000);
  };
  video.addEventListener('waiting', armStall);
  video.addEventListener('stalled', armStall);
  video.addEventListener('playing', clearStall);
  video.addEventListener('canplay', clearStall);
  liveStallCleanup = () => {
    video.removeEventListener('waiting', armStall);
    video.removeEventListener('stalled', armStall);
    video.removeEventListener('playing', clearStall);
    video.removeEventListener('canplay', clearStall);
  };
}

async function ensureLiveChannels() {
  if (state.catalogs.live?.loaded) return liveChannels();
  const catalog = await ensureCatalog('live', { quiet: true });
  return catalog.items || [];
}

function itemIndex(items, item) {
  return items.findIndex(value => String(value.id) === String(item?.id));
}

function syncPlayerFavoriteButton() {
  const favoriteButton = document.getElementById('favorite-toggle');
  const item = currentPlayerItem;
  if (!favoriteButton || !item) return;
  const refresh = () => {
    favoriteButton.textContent = isFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId()) ? '★ Favorito' : '☆ Favoritar';
  };
  refresh();
  favoriteButton.onclick = () => {
    toggleFavoriteTracked(item);
    saveFavorites(state.favorites);
    refresh();
  };
}

async function playLiveChannelInCurrentPlayer(item, { keepPanel = false } = {}) {
  if (!item || item.kind !== 'live' || state.lastView !== 'player') return false;
  if (!(await authorizeParentalPlayback(item))) return false;
  const video = currentPlayerVideo || document.getElementById('video-player');
  const message = document.getElementById('player-message');
  if (!video || !message) return false;
  const sessionVersion = beginPlayerSession({ preserveControls: true });

  hideLiveRecovery();
  cancelLiveReconnect();
  clearLiveWebStallWatch();
  await player.stop();
  if (!isPlayerSessionCurrent(sessionVersion)) return false;
  currentPlayerItem = item;
  currentPlayerVideo = video;
  const title = document.getElementById('player-title');
  const subtitle = document.getElementById('player-subtitle');
  if (title) title.textContent = item.name || 'Canal';
  if (subtitle) subtitle.textContent = 'TV ao vivo';
  cinemaControls?.setItem(item);
  syncPlayerFavoriteButton();
  showLiveZapOverlay(item, cachedLiveEpg(item));
  message.classList.add('hidden');

  try {
    const playback = await getLivePlayback(item);
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return false;
    await player.play(video, playback);
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return false;
    watchLiveWebStalls(video);
    markLivePlaybackStable();
    const items = liveChannels();
    const index = Math.max(0, itemIndex(items, item));
    primeNearbyLivePlayback(items, index);
    loadNowPlaying(item, sessionVersion, video).catch(() => {});
    if (keepPanel) {
      livePanelSelectedIndex = index;
      renderLiveChannelPanel(items);
      hydrateVisibleLivePanelEpg(items).catch(() => {});
    }
    return true;
  } catch (error) {
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return false;
    await report('warn', `Falha de reprodução (live/${item.id}): ${error.message}`);
    message.textContent = `Não foi possível abrir ${item.name || 'este canal'}. ${error.message}`;
    message.classList.remove('hidden');
    scheduleLiveReconnect(error.message);
    return false;
  }
}

function renderLiveChannelPanel(items) {
  const panel = document.getElementById('live-channel-panel');
  const list = document.getElementById('live-channel-list');
  if (!panel || !list || !items.length) return;
  const windowSize = livePanelWindowSize();
  const maxStart = Math.max(0, items.length - windowSize);
  if (livePanelSelectedIndex < livePanelStart || livePanelSelectedIndex >= livePanelStart + windowSize) {
    livePanelStart = Math.min(maxStart, Math.max(0, livePanelSelectedIndex - Math.floor(windowSize / 2)));
  }
  const end = Math.min(items.length, livePanelStart + windowSize);
  const currentId = String(currentPlayerItem?.id || '');
  list.innerHTML = items.slice(livePanelStart, end).map((channel, offset) => {
    const index = livePanelStart + offset;
    const current = String(channel.id) === currentId;
    const selected = index === livePanelSelectedIndex;
    const epg = cachedLiveEpg(channel);
    const now = epg?.now;
    const next = epg?.next;
    const percent = liveProgramPercent(now);
    const favorite = isFavorite(state.favorites, channel, state.activeAccount?.id, activeProfileId());
    return `<button class="live-channel-option${current ? ' current' : ''}${selected ? ' selected' : ''}" tabindex="-1" data-live-index="${index}">
      <div class="live-channel-logo">${channel.image ? `<img src="${esc(channel.image)}" alt="" referrerpolicy="no-referrer">` : '<span>▣</span>'}</div>
      <div class="live-channel-copy">
        <strong>${esc(channel.name || 'Canal')}</strong>
        <small class="live-channel-now">${now ? `Agora • ${esc(liveProgramTime(now))} • ${esc(now.title || 'Programação')}` : 'Carregando programação…'}</small>
        <div class="live-channel-progress"><i style="width:${percent}%"></i></div>
        <small class="live-channel-next">${next ? `Próximo • ${esc(liveProgramTime(next))} • ${esc(next.title || 'Programação')}` : ''}</small>
      </div>
      <span class="live-channel-favorite${favorite ? ' active' : ''}" aria-hidden="true">${favorite ? '★' : '☆'}</span>
    </button>`;
  }).join('');
  const selected = list.querySelector(`[data-live-index="${livePanelSelectedIndex}"]`);
  try { selected?.focus({ preventScroll: true }); } catch { selected?.focus(); }
}

async function hydrateVisibleLivePanelEpg(items) {
  const panel = document.getElementById('live-channel-panel');
  if (!panel || panel.classList.contains('hidden')) return;
  const version = ++liveEpgRequestVersion;
  const end = Math.min(items.length, livePanelStart + livePanelWindowSize());
  const visible = items.slice(livePanelStart, end);
  try {
    await loadLiveEpg(visible);
    if (version !== liveEpgRequestVersion || !liveChannelPanelOpen()) return;
    renderLiveChannelPanel(items);
  } catch (error) {
    report('warn', `EPG lateral indisponível: ${error?.message || error}`);
  }
}

async function showLiveChannelPanel() {
  if (currentPlayerItem?.kind !== 'live') return false;
  const panel = document.getElementById('live-channel-panel');
  if (!panel) return false;
  const items = await ensureLiveChannels();
  if (!items.length) return false;
  livePanelSelectedIndex = Math.max(0, itemIndex(items, currentPlayerItem));
  const windowSize = livePanelWindowSize();
  livePanelStart = Math.min(
    Math.max(0, items.length - windowSize),
    Math.max(0, livePanelSelectedIndex - Math.floor(windowSize / 2))
  );
  panel.classList.remove('hidden');
  renderLiveChannelPanel(items);
  hydrateVisibleLivePanelEpg(items).catch(() => {});
  return true;
}

function hideLiveChannelPanel() {
  liveEpgRequestVersion += 1;
  document.getElementById('live-channel-panel')?.classList.add('hidden');
}

function liveChannelPanelOpen() {
  const panel = document.getElementById('live-channel-panel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}

async function switchLiveChannel(delta, explicitIndex = null) {
  if (currentPlayerItem?.kind !== 'live' || channelSwitchPending) return false;
  channelSwitchPending = true;
  try {
    const items = await ensureLiveChannels();
    if (!items.length) return false;
    const current = Math.max(0, itemIndex(items, currentPlayerItem));
    const targetIndex = explicitIndex == null
      ? (current + delta + items.length) % items.length
      : Math.min(items.length - 1, Math.max(0, explicitIndex));
    const target = items[targetIndex];
    if (!target) return false;
    if (String(target.id) === String(currentPlayerItem?.id)) {
      if (explicitIndex != null) hideLiveChannelPanel();
      showLiveZapOverlay(target, cachedLiveEpg(target));
      hydrateLiveZapOverlay(target).catch(() => {});
      return true;
    }
    const switched = await playLiveChannelInCurrentPlayer(target);
    if (switched && explicitIndex != null) hideLiveChannelPanel();
    return switched;
  } finally {
    channelSwitchPending = false;
  }
}

function moveLivePanelSelection(delta) {
  const items = liveChannels();
  if (!items.length) return;
  livePanelSelectedIndex = Math.min(items.length - 1, Math.max(0, livePanelSelectedIndex + delta));
  const windowSize = livePanelWindowSize();
  if (livePanelSelectedIndex < livePanelStart || livePanelSelectedIndex >= livePanelStart + windowSize) {
    renderLiveChannelPanel(items);
    hydrateVisibleLivePanelEpg(items).catch(() => {});
    return;
  }
  const list = document.getElementById('live-channel-list');
  list?.querySelector('.selected')?.classList.remove('selected');
  const selected = list?.querySelector(`[data-live-index="${livePanelSelectedIndex}"]`);
  selected?.classList.add('selected');
  try { selected?.focus({ preventScroll: true }); } catch { selected?.focus(); }
}

function toggleLivePanelFavorite() {
  const items = liveChannels();
  const channel = items[livePanelSelectedIndex];
  if (!channel) return;
  const added = toggleFavoriteTracked(channel);
  saveFavorites(state.favorites);
  renderLiveChannelPanel(items);
  syncPlayerFavoriteButton();
  toast(added ? `${channel.name || 'Canal'} adicionado aos favoritos.` : `${channel.name || 'Canal'} removido dos favoritos.`);
}

function playerRemoteKey(event) {
  const androidTv = document.documentElement.classList.contains('android-tv');
  if ((!isSamsungTv() && !androidTv && !isDesktopPlayer()) || state.lastView !== 'player') return;
  if (modalRoot.childElementCount) return;
  const desktop = isDesktopPlayer();
  if (desktop && cinemaControls && !liveRecoveryOpen() && !liveChannelPanelOpen()) {
    if (cinemaControls.handleKey(event)) return;
    // Arrow keys on the new controls navigate focus, never the legacy ±30s seek.
    if (event.target?.closest?.('.cinema-player button') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  }
  if (desktop && (event.altKey || event.ctrlKey || event.metaKey || event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))) return;
  const code = Number(event.keyCode || event.which || 0);
  const key = String(event.key || event.code || '');
  const isBack = code === 10009 || key === 'XF86Back' || key === 'BrowserBack' || (desktop && key === 'Escape');
  const isOk = code === 13 || key === 'Enter' || key === 'Select' || key === 'OK';
  if (desktop && event.target?.closest?.('button') && !liveRecoveryOpen() && !liveChannelPanelOpen() && (isOk || key === ' ' || key === 'Space')) return;
  const isLeft = code === 37 || key === 'ArrowLeft';
  const isRight = code === 39 || key === 'ArrowRight';
  const isUp = code === 38 || key === 'ArrowUp';
  const isDown = code === 40 || key === 'ArrowDown';
  const isChannelUp = code === 427 || key === 'ChannelUp' || key === 'XF86ChannelUp' || (desktop && key === 'PageDown');
  const isChannelDown = code === 428 || key === 'ChannelDown' || key === 'XF86ChannelDown' || (desktop && key === 'PageUp');
  const isMediaPlay = code === 415 || key === 'MediaPlay' || key === 'XF86AudioPlay';
  const isMediaPause = code === 19 || key === 'MediaPause' || key === 'XF86AudioPause';
  const isMediaPlayPause = code === 10252 || key === 'MediaPlayPause' || key === 'PlayPause' || (desktop && (key === ' ' || key === 'Space'));

  if (isMediaPlay || isMediaPause || isMediaPlayPause) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) {
      const action = isMediaPlay ? 'play' : isMediaPause ? 'pause' : 'toggle';
      setCurrentPlaybackState(action).catch(handleError);
    }
    return;
  }

  if (isSeekableKind(currentPlayerItem?.kind)) {
    if (isUp) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) openPlayerTrackMenu().catch(handleError);
      return;
    }
    if (isOk) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleCurrentVideoPlayback().catch(handleError);
      return;
    }
    if (isLeft || isRight) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const now = Date.now();
      if (now - lastSeekKeyAt >= SEEK_REPEAT_MS) {
        lastSeekKeyAt = now;
        seekCurrentVideo(isRight ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS).catch(handleError);
      }
      return;
    }
    return;
  }

  if (currentPlayerItem?.kind !== 'live') return;

  if (liveRecoveryOpen()) {
    if (isBack) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runLiveRecoveryAction('back').catch(handleError);
      return;
    }
    if (isLeft || isRight || isUp || isDown) {
      event.preventDefault();
      event.stopImmediatePropagation();
      focusLiveRecoveryAction(liveRecoverySelectedIndex + ((isLeft || isUp) ? -1 : 1));
      return;
    }
    if (isOk) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const recovery = document.getElementById('player-recovery');
      const actions = Array.from(recovery?.querySelectorAll('[data-live-recovery]') || []);
      const action = actions[liveRecoverySelectedIndex]?.dataset.liveRecovery;
      if (action) runLiveRecoveryAction(action).catch(handleError);
      return;
    }
    return;
  }

  if (liveChannelPanelOpen()) {
    if (isBack) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideLiveChannelPanel();
      return;
    }
    if (isUp || isDown) {
      event.preventDefault();
      event.stopImmediatePropagation();
      moveLivePanelSelection(isUp ? -1 : 1);
      return;
    }
    if (isRight) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleLivePanelFavorite();
      return;
    }
    if (isOk) {
      event.preventDefault();
      event.stopImmediatePropagation();
      switchLiveChannel(0, livePanelSelectedIndex).catch(handleError);
      return;
    }
  } else if (isOk) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showLiveChannelPanel().catch(handleError);
    return;
  }

  if (isChannelUp || isChannelDown) {
    event.preventDefault();
    event.stopImmediatePropagation();
    switchLiveChannel(isChannelUp ? 1 : -1).catch(handleError);
  }
}

async function restorePlaybackProgress(item, video) {
  if (!['vod', 'series'].includes(item.kind) || !state.activeAccount) return;
  const entry = findHistoryEntry(state.history, item, state.activeAccount.id, activeProfileId());
  if (!entry || entry.completed || entry.position < 10) return;
  await player.seek(video, entry.position);
  toast(`Retomando de ${formatPlaybackTime(entry.position)}.`);
}

function setAccountState(value) {
  state.accountState = value;
  if (state.lastView === 'home') updateHomeIndicators(state);
}

function activeFromList(list) {
  return list.accounts.find(account => account.id === list.activeId) || null;
}

async function reloadAccounts({ loadSummary = true } = {}) {
  invalidateCatalogSession();
  const previousAccountId = state.activeAccount?.id || '';
  const list = await window.desktopAPI.accounts.list();
  liveEpgCache.clear();
  livePlaybackCache.clear();
  clearContentDetailCaches();
  clearPreservedSeriesCatalogView();
  state.accounts = list.accounts || [];
  state.activeAccount = activeFromList(list);
  if (!state.activeAccount || state.activeAccount.id !== previousAccountId) state.activeProfile = null;
  if (state.activeAccount && state.favorites.some(item => !item.accountId)) {
    state.favorites = state.favorites.map(item => item.accountId ? item : sanitizeFavorite(item, state.activeAccount.id));
    saveFavorites(state.favorites);
  }
  syncProfilesForAccounts();
  state.accountState = state.activeAccount ? 'configured' : 'disconnected';
  state.summary = state.activeAccount && loadSummary
    ? await window.desktopAPI.catalog.summary()
    : { live: 0, vod: 0, series: 0, radio: 0 };
}

async function hydrateStartupMetadata(appInfoPromise) {
  const summaryPromise = state.activeAccount
    ? window.desktopAPI.catalog.summary()
    : Promise.resolve({ live: 0, vod: 0, series: 0, radio: 0 });
  const [appInfoResult, summaryResult] = await Promise.allSettled([appInfoPromise, summaryPromise]);
  if (appInfoResult.status === 'fulfilled' && appInfoResult.value) state.appInfo = appInfoResult.value;
  if (summaryResult.status === 'fulfilled' && summaryResult.value) {
    state.summary = { ...state.summary, ...summaryResult.value };
    updateHomeSummaryUi();
  } else if (summaryResult.status === 'rejected') {
    report('warn', `Resumo inicial indisponível: ${summaryResult.reason?.message || summaryResult.reason}`);
  }
}

async function init() {
  try {
    const appInfoPromise = window.desktopAPI.getAppInfo();
    await reloadAccounts({ loadSummary: false });
    bindGlobalEvents();
    initRemoteNavigation({ onBack: handleBack });
    updateClock();
    setInterval(updateClock, 30000);
    if (!state.activeAccount) openAccounts();
    else if (isTvDevice()) openProfiles();
    else {
      const remembered = rememberedProfile(state.profileState, state.activeAccount.id);
      if (hasProfilePin(remembered)) openProfiles();
      else {
        state.activeProfile = remembered;
        renderHomeView();
      }
    }
    hydrateStartupMetadata(appInfoPromise).catch(error => report('warn', `Metadados iniciais indisponíveis: ${error?.message || error}`));
    report('info', `Renderer pronto. Contas: ${state.accounts.length}.`);
  } catch (error) {
    await report('error', error?.stack || error?.message || error);
    toast(`Falha ao iniciar: ${error.message}`);
  }
}

function updateClock() {
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date());
}

function bindGlobalEvents() {
  const registerInteraction = event => { if (event.isTrusted && state.lastView === 'player') inactivityGuard.interact(); };
  for (const name of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(name, registerInteraction, { capture: true, passive: true });
  window.addEventListener('keydown', playerRemoteKey, true);
  window.addEventListener('keydown', event => {
    if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input, textarea, [contenteditable]')) return;
    if (state.lastView === 'player' || !state.activeAccount) return;
    event.preventDefault();
    navigate('search').catch(handleError);
  });
  window.addEventListener('metalloide:playback-error', event => {
    if (currentPlayerItem?.kind === 'live') scheduleLiveReconnect(event?.detail?.error || event?.detail?.source || 'erro de reprodução');
  });
  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      navigate(viewButton.dataset.view).catch(handleError);
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === 'open-account') openAccounts();
    if (action === 'switch-profile') openProfiles({ switching: true });
    if (action === 'show-recommendations') {
      const section = qs('#recommendations-section');
      if (section && !section.classList.contains('hidden')) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else toast('Assista a um filme ou episódio para receber sugestões personalizadas.');
    }
    if (action === 'refresh') refreshAll().catch(handleError);
    if (action === 'backup') openBackups();
    if (action === 'support') openSupportModal(state, player.capabilities());
    if (action === 'diagnostics') runDiagnostics(actionButton).catch(handleError);
    if (action === 'check-update') window.desktopAPI.updates?.check?.().catch(handleError);
  });
  window.addEventListener('error', event => report('error', event.error?.stack || event.message));
  window.addEventListener('unhandledrejection', event => report('error', event.reason?.stack || event.reason?.message || String(event.reason)));
}

function handleError(error) {
  if (error?.name === 'AbortError') return;
  report('error', error?.stack || error?.message || error);
  toast(error?.message || 'Ocorreu um erro inesperado.');
}

async function requestPlayback(item, options = {}) {
  if (!item) return;
  if (isTitleBlocked(state.activeProfile, item)) return toast('Este título está bloqueado neste perfil.');
  if (options.startFromBeginning) return openPlayer(item, options);
  const resumable = ['vod', 'series'].includes(item.kind) && state.activeAccount;
  const entry = resumable ? findHistoryEntry(state.history, item, state.activeAccount.id, activeProfileId()) : null;
  if (!entry || entry.completed || entry.position < 10) return openPlayer(item, options);

  openResumePlaybackModal(item, formatPlaybackTime(entry.position), {
    onResume: () => openPlayer(item, options).catch(handleError),
    onRestart: () => {
      state.history = removeHistoryEntry(state.history, entry.key);
      saveHistory(state.history);
      openPlayer(item, options).catch(handleError);
    }
  });
}

async function resumeContinueEntry(entry) {
  const item = entry.item;
  if (item.kind !== 'series' || !item.seriesId || state.activeAccount?.type !== 'xtream') return requestPlayback(item);
  const accountId = state.activeAccount.id;
  const profileId = activeProfileId();
  const view = state.lastView;
  const series = state.catalogs.series.items.find(row => String(row.id) === item.seriesId)
    || { ...item, id: item.seriesId, name: item.seriesName || item.name, episode: '' };
  const episodes = await getSeriesEpisodesCached(series);
  if (state.activeAccount?.id !== accountId || activeProfileId() !== profileId || state.lastView !== view) return;
  const index = episodes.findIndex(episode => String(episode.id) === item.id);
  if (index < 0) return requestPlayback(item);
  return requestPlayback(episodes[index], { seriesContext: { series, episodes, index } });
}

function openSeriesContextModal(context) {
  if (!context?.series || !context?.episodes?.length) return false;
  const explicitIndex = Number.isInteger(context.index) && context.index >= 0 && context.index < context.episodes.length
    ? context.index
    : null;
  let initialEpisodeIndex = explicitIndex;
  if (initialEpisodeIndex == null && state.activeAccount) {
    let newestUpdatedAt = -1;
    context.episodes.forEach((episode, index) => {
      const entry = findHistoryEntry(state.history, episode, state.activeAccount.id, activeProfileId());
      if (!entry || entry.completed || entry.position < 10 || entry.updatedAt <= newestUpdatedAt) return;
      newestUpdatedAt = entry.updatedAt;
      initialEpisodeIndex = index;
    });
  }
  if (initialEpisodeIndex == null) initialEpisodeIndex = 0;
  openEpisodeModal(context.series, context.episodes, (episode, index) => {
    requestPlayback(episode, {
      seriesContext: { ...context, index }
    }).catch(handleError);
  }, {
    isWatched: episode => Boolean(findHistoryEntry(state.history, episode, state.activeAccount?.id, activeProfileId())?.completed),
    getProgress: episode => {
      const entry = findHistoryEntry(state.history, episode, state.activeAccount?.id, activeProfileId());
      return entry && !entry.completed ? historyProgressPercent(entry) : 0;
    },
    initialEpisodeIndex,
    ...detailOptions(context.series)
  });
  return true;
}

async function returnToCurrentSeries() {
  if (currentPlayerItem?.kind !== 'series' || !currentSeriesContext?.series || !currentSeriesContext?.episodes?.length) return false;
  const context = currentSeriesContext;
  setDiscoverFullscreen(false);
  invalidatePlayerSession();
  document.body.classList.remove('live-player-fullscreen');
  cancelLiveReconnect();
  await stopPlaybackTracking();
  await player.stop();
  currentPlayerVideo = null;
  currentPlayerItem = null;
  state.lastView = 'series';
  previousView = 'series';
  if (!restorePreservedSeriesCatalogView()) await renderCatalog('series');
  openSeriesContextModal(context);
  return true;
}

function handleBack() {
  if (modalRoot.childElementCount) return closeModal();
  if (state.lastView === 'profiles-manager') return openProfiles({ switching: true });
  if (state.lastView === 'profiles') {
    if (state.activeProfile) return renderHomeView();
    return openAccounts();
  }
  if (state.lastView === 'player' && currentPlayerItem?.kind === 'series' && currentSeriesContext?.series) {
    return returnToCurrentSeries().catch(handleError);
  }
  if (isTvDevice() && state.lastView === 'accounts') {
    if (state.activeAccount) return renderHomeView();
    return window.desktopAPI.exit?.();
  }
  if (state.lastView !== 'home') return navigate(previousView && previousView !== state.lastView ? previousView : 'home').catch(handleError);
  window.desktopAPI.exit?.();
}

async function navigate(view) {
  if (isTvDevice() && !state.activeAccount) return openAccounts();
  if (state.activeAccount && !state.activeProfile) return openProfiles();
  setDiscoverFullscreen(view === 'discover' || view === 'recent');
  disposeDiscover();
  invalidatePlayerSession();
  document.body.classList.remove('account-login');
  document.body.classList.remove('profile-selection');
  document.body.classList.remove('live-player-fullscreen');
  cancelLiveReconnect();
  clearLiveWebStallWatch();
  await stopPlaybackTracking();
  await player.stop();
  if (view !== 'series' && !(view === 'player' && currentPlayerItem?.kind === 'series')) clearPreservedSeriesCatalogView();
  if (view !== state.lastView) previousView = state.lastView;
  state.lastView = view;
  if (view === 'home') return renderHomeView();
  if (view === 'search') return renderGlobalSearch();
  if (view === 'settings') return renderSettingsView();
  if (view === 'favorites') return renderFavorites();
  if (view === 'history') return renderHistory();
  if (view === 'discover') return renderDiscover();
  if (view === 'recent') return renderDiscover('recent');
  if (view === 'epg') return renderEpg();
  if (['live', 'vod', 'series', 'radio'].includes(view)) return renderCatalog(view);
  return renderHomeView();
}

async function renderGlobalSearch() {
  const accountId = String(state.activeAccount?.id || '');
  const profileId = activeProfileId();
  root.innerHTML = '<section class="discover-loading-view" role="status">Preparando a busca de filmes e séries…</section>';
  const results = await Promise.allSettled([
    ensureCatalog('vod', { quiet: true }), ensureCatalog('series', { quiet: true })
  ]);
  if (state.lastView !== 'search' || String(state.activeAccount?.id || '') !== accountId || activeProfileId() !== profileId) return;
  if (results.every(result => result.status === 'rejected') && !state.catalogs.vod.loaded && !state.catalogs.series.loaded) {
    root.innerHTML = '<section class="discover-loading-view">Não foi possível carregar o catálogo. <button data-view="home">Voltar ao início</button></section>';
    return;
  }
  const catalogs = { vod: visibleCatalog(state.catalogs.vod), series: visibleCatalog(state.catalogs.series) };
  renderSearchView(catalogs, { onOpen: item => openItem(item).catch(handleError) });
  if (results.some(result => result.status === 'rejected')) toast('Parte do catálogo está indisponível; mostrando os títulos carregados.');
}

async function renderDiscover(mode = 'discover') {
  const recent = mode === 'recent';
  const accountId = String(state.activeAccount?.id || '');
  root.innerHTML = `<section class="discover-loading-view" role="status">${recent ? 'Buscando filmes e séries adicionados recentemente…' : 'Preparando seu feed Descubra…'}</section>`;
  const results = await Promise.allSettled([
    ensureCatalog('vod', { quiet: true, refresh: recent }),
    ensureCatalog('series', { quiet: true, refresh: recent })
  ]);
  if (state.lastView !== mode || String(state.activeAccount?.id || '') !== accountId) return;
  const vod = results[0].status === 'fulfilled' ? results[0].value : state.catalogs.vod;
  const series = results[1].status === 'fulfilled' ? results[1].value : state.catalogs.series;
  if (results.every(result => result.status === 'rejected') && !vod?.loaded && !series?.loaded) {
    root.innerHTML = '<section class="discover-loading-view">Não foi possível carregar o catálogo. <button data-view="home">Voltar ao início</button></section>';
    return;
  }
  let items;
  let categories;
  let onCategoryChange;
  if (recent) {
    const key = recentStorageKey(accountId);
    let prior = null;
    try { prior = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    // A failed request must not establish or change the inventory baseline.
    const fresh = {};
    const available = {};
    if (vod?.loaded) available.vod = vod;
    if (series?.loaded) available.series = series;
    if (results[0].status === 'fulfilled' && vod.source === 'network') fresh.vod = vod;
    if (results[1].status === 'fulfilled' && series.source === 'network') fresh.series = series;
    const now = Date.now();
    const feed = buildRecentFeed(fresh, prior, { now });
    if (Object.keys(fresh).length) {
      try { localStorage.setItem(key, JSON.stringify(feed.snapshot)); } catch {}
    }
    // Cached/offline catalogs can be shown, but must not create a false
    // "newly added" timestamp or advance the inventory baseline.
    const displayed = buildRecentFeed(available, feed.snapshot, { now, detectNew: false });
    items = visibleItems(displayed.items);
    categories = displayed.categories;
    onCategoryChange = category => visibleItems(buildRecentFeed(available, feed.snapshot, { now, category, detectNew: false }).items);
  } else {
    const catalogs = { vod: visibleCatalog(vod), series: visibleCatalog(series) };
    const options = {
      accountId, profileId: activeProfileId(), favorites: state.favorites,
      history: state.history, day: `${Date.now()}:${Math.random()}`, limit: 70
    };
    items = buildDiscoverFeed(catalogs, options);
    categories = buildFeedCategories(catalogs);
    onCategoryChange = category => buildDiscoverFeed(catalogs, { ...options, category });
  }
  const categoryResults = new Map([['all', items]]);
  const rebuildCategory = onCategoryChange;
  onCategoryChange = category => {
    if (!categoryResults.has(category)) categoryResults.set(category, rebuildCategory(category));
    return categoryResults.get(category);
  };
  discoverController = renderDiscoverView(items, {
    mode, categories, onCategoryChange,
    isFavorite: item => isFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId()),
    onFavorite: item => {
      toggleFavoriteTracked(item);
      saveFavorites(state.favorites);
    },
    onPreview: resolvePreviewPlayback,
    onWatch: item => item.kind === 'vod' ? requestPlayback(item) : openItem(item),
    onDetails: openItem,
    onShare: async item => {
      const message = `Conheça ${item.name} no MTPLAYER.`;
      if (navigator.share) {
        try { await navigator.share({ title: item.name, text: message }); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
      try {
        await navigator.clipboard.writeText(message);
        toast('Indicação copiada para compartilhar.');
      } catch { toast('Compartilhamento indisponível neste dispositivo.'); }
    }
  });
  if (recent && results.some(result => result.status === 'rejected' || result.value?.offline)) {
    toast('Sem conexão com parte do catálogo. Exibindo dados salvos; as novidades podem estar desatualizadas.');
  }
}

function lightweightPreviewItem(item) {
  const source = state.catalogs[item.kind];
  if (!source?.items?.length) return item;
  const scope = `${state.activeAccount?.id}:${activeProfileId()}:${Boolean(state.activeProfile?.kidsMode)}`;
  let cached = previewEditionCaches.get(item.kind);
  if (!cached || cached.items !== source.items || cached.scope !== scope) {
    const catalog = visibleCatalog(source);
    cached = { items: source.items, scope, index: buildPreviewEditionIndex(catalog.items, catalog.categories) };
    previewEditionCaches.set(item.kind, cached);
  }
  return cached.index.get(`${item.kind}:${item.id}`) || item;
}

async function resolvePreviewPlayback(item, { signal } = {}) {
  if (!item || !['vod', 'series'].includes(item.kind)) return null;
  if (signal?.aborted || isTitleBlocked(state.activeProfile, item)) return null;
  const profileId = activeProfileId();
  const accountId = state.activeAccount?.id;
  let playable = lightweightPreviewItem(item);
  if (playable.kind === 'series' && state.activeAccount?.type === 'xtream' && !playable.episode) {
    const episodes = await getSeriesEpisodesCached(playable);
    if (signal?.aborted) return null;
    playable = episodes[0];
  }
  if (!playable || signal?.aborted || accountId !== state.activeAccount?.id || profileId !== activeProfileId()
      || isTitleBlocked(state.activeProfile, item)) return null;
  return window.desktopAPI.playback.get(playable, state.settings.streamType);
}

function acceptCatalog(kind, catalog, { refresh }) {
  state.catalogs[kind] = { ...catalog, loaded: true };
  state.summary[kind] = catalog.items?.length || 0;
  previewEditionCaches.delete(kind);
  homeDerivedCache = null;
  setAccountState(catalog.offline ? 'offline' : 'online');
  if (refresh) {
    if (kind === 'series' && state.lastView === 'player' && currentPlayerItem?.kind === 'series') clearPreservedSeriesCatalogView();
    if (state.lastView === kind) renderCatalogView(kind, visibleCatalog(state.catalogs[kind]), catalogViewOptions());
  }
  if (state.lastView === 'home') scheduleHomeRender();
  if (catalog.stale && !refresh) {
    const session = catalogSessionVersion;
    Promise.resolve().then(() => {
      if (session !== catalogSessionVersion) return;
      return ensureCatalog(kind, { refresh: true, quiet: true });
    }).catch(error => {
      if (error?.name !== 'AbortError') report('warn', `Atualização em segundo plano (${kind}): ${error.message}`);
    });
  }
}

async function ensureCatalog(kind, { refresh = false, quiet = false } = {}) {
  if (catalogAccountTransition) {
    const error = new Error('Aguarde a troca de conta.');
    error.name = 'AbortError';
    throw error;
  }
  if (!state.activeAccount) {
    openAccounts();
    throw new Error('Configure uma conta primeiro.');
  }
  const existing = state.catalogs[kind];
  const accountId = state.activeAccount.id;
  const session = catalogSessionVersion;
  if (existing.loaded && !refresh) return existing;
  let loadingModal = null;
  if (!quiet && !existing.loaded) {
    showLoadingModal('Carregando conteúdo...', 'O cache local será usado quando estiver disponível.');
    loadingModal = modalRoot.firstElementChild;
  }
  setAccountState('connecting');
  try {
    await catalogLoader.get(kind, { refresh });
    if (session !== catalogSessionVersion || state.activeAccount?.id !== accountId) {
      const error = new Error('Carregamento cancelado por mudança de conta.');
      error.name = 'AbortError';
      throw error;
    }
    return state.catalogs[kind];
  } catch (error) {
    if (error?.name === 'AbortError' || session !== catalogSessionVersion || state.activeAccount?.id !== accountId) throw error;
    setAccountState(/senha|autent|recusad/i.test(error.message) ? 'authentication_error' : 'offline');
    throw error;
  } finally {
    if (loadingModal && modalRoot.firstElementChild === loadingModal) closeModal();
  }
}

async function playPreviewFromBeginning(item) {
  if (!playbackPreferences(state.activeProfile).previewAutoplay) return;
  const session = catalogSessionVersion;
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const view = state.lastView;
  let playable = item;
  let seriesContext = null;
  if (item.kind === 'series' && state.activeAccount?.type === 'xtream' && !item.episode) {
    const episodes = await getSeriesEpisodesCached(item);
    if (session !== catalogSessionVersion || accountId !== state.activeAccount?.id
        || profileId !== activeProfileId() || view !== state.lastView) return;
    if (!episodes.length) return toast('Nenhum episódio disponível.');
    playable = episodes[0];
    seriesContext = { series: item, episodes, index: 0 };
  }
  return requestPlayback(playable, { startFromBeginning: true, fullscreen: true, seriesContext });
}

function catalogViewOptions() {
  return {
    pageSize: catalogPageSize(), onOpen: item => openItem(item).catch(handleError),
    onPreview: playbackPreferences(state.activeProfile).previews ? resolvePreviewPlayback : null,
    onAutoPlay: playbackPreferences(state.activeProfile).previewAutoplay ? item => playPreviewFromBeginning(item).catch(handleError) : null,
    ...ratingOptions(),
    onPlay: async item => {
      try {
        if (item.kind === 'series' && state.activeAccount?.type === 'xtream' && !item.episode) {
          const episodes = await getSeriesEpisodesCached(item);
          if (!episodes.length) return toast('Nenhum episódio disponível.');
          return await requestPlayback(episodes[0], { seriesContext: { series: item, episodes, index: 0 } });
        }
        return await requestPlayback(item);
      } catch (error) { handleError(error); }
    },
    isFavorite: item => isFavorite(state.favorites, item, state.activeAccount?.id, activeProfileId()),
    onFavorite: item => {
      toggleFavoriteTracked(item);
      saveFavorites(state.favorites);
    },
    onPreviewDetails: item => {
      if (item.kind === 'vod') return vodDetailsCache.get(contentCacheKey(item)) || item;
      if (item.kind === 'series' && state.activeAccount?.type === 'xtream') {
        const episodes = seriesEpisodesCache.get(contentCacheKey(lightweightPreviewItem(item)));
        return episodes ? { ...item, episodeCount: episodes.length } : item;
      }
      return item;
    }
  };
}

async function renderCatalog(kind) {
  const session = catalogSessionVersion;
  const catalog = await ensureCatalog(kind);
  if (session !== catalogSessionVersion || state.lastView !== kind) return;
  renderCatalogView(kind, visibleCatalog(catalog), catalogViewOptions());
}

function renderFavorites() {
  if (!state.activeAccount) return openAccounts();
  const byKind = new Map();
  const favorites = activeFavorites(state).map(favorite => {
    if (!byKind.has(favorite.kind)) byKind.set(favorite.kind, new Map((state.catalogs[favorite.kind]?.items || []).map(item => [String(item.id), item])));
    const source = byKind.get(favorite.kind).get(favorite.id);
    return { ...favorite, ...source, kind: favorite.kind, savedAt: favorite.savedAt };
  });
  renderFavoritesView(visibleItems(favorites), { ...catalogViewOptions(), history: state.history,
    accountId: state.activeAccount.id, profileId: activeProfileId() });
}

function renderSettingsView() {
  renderSettings(state, {
    onChange: () => {
      saveSettings(state.settings);
      renderSettingsView();
      toast('Preferência atualizada.');
    }
  });
  const updateButton = document.querySelector('[data-action="check-update"]');
  if (updateButton && !window.desktopAPI.updates?.check) updateButton.remove();
}

async function renderEpg() {
  const catalog = await ensureCatalog('live');
  await renderEpgView(visibleCatalog(catalog), {
    getEpg: ids => window.desktopAPI.epg.getMany(ids),
    onOpen: openItem,
    onCatchup: openCatchup
  });
}

async function openCatchup(channel) {
  if (!channel || !window.desktopAPI.epg?.getArchive) return;
  if (!(await authorizeParentalPlayback(channel))) return;
  showLoadingModal('Carregando TV atrasada...');
  try {
    const programs = await window.desktopAPI.epg.getArchive(channel);
    closeModal();
    if (!programs?.length) return toast('Nenhum programa anterior disponível para este canal.');
    openCatchupModal(channel, programs, {
      onPlay: program => {
        if (!program?.start || !program?.end) return;
        closeModal();
        const item = {
          ...channel,
          kind: 'catchup',
          id: `catchup:${channel.id}:${program.start}`,
          channelId: channel.id,
          sourceId: channel.sourceId || channel.id,
          name: program.title || channel.name || 'TV atrasada',
          channelName: channel.name || '',
          programTitle: program.title || '',
          description: program.description || '',
          programStart: program.start,
          programEnd: program.end
        };
        openPlayer(item).catch(handleError);
      }
    });
  } catch (error) {
    closeModal();
    throw error;
  }
}

async function openItem(item) {
  if (!item) return;
  if (isTitleBlocked(state.activeProfile, item)) return toast('Este título está bloqueado neste perfil.');
  const requestVersion = ++itemDetailsRequestVersion;
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const session = catalogSessionVersion;
  const view = state.lastView;
  const isCurrent = () => requestVersion === itemDetailsRequestVersion && accountId === state.activeAccount?.id
    && profileId === activeProfileId() && session === catalogSessionVersion && view === state.lastView;
  if (item.kind === 'vod') {
    let movie = vodDetailsCache.get(contentCacheKey(item)) || item;
    if (window.desktopAPI.catalog.details && movie === item) {
      showLoadingModal('Carregando sinopse...');
      const loading = modalRoot.firstElementChild;
      try {
        movie = await getVodDetailsCached(item);
        if (!isCurrent() || modalRoot.firstElementChild !== loading) return;
      } catch (error) {
        if (!isCurrent() || modalRoot.firstElementChild !== loading) return;
        report('warn', 'Detalhes do filme indisponíveis.').catch(() => {});
      } finally {
        if (modalRoot.firstElementChild === loading) closeModal();
      }
    }
    if (!isCurrent()) return;
    openMovieModal(movie, selected => requestPlayback(selected).catch(handleError), detailOptions(movie));
    return;
  }
  if (item.kind === 'series' && state.activeAccount?.type === 'xtream' && !item.episode) {
    const cachedEpisodes = seriesEpisodesCache.get(contentCacheKey(item));
    if (cachedEpisodes?.length) {
      openSeriesContextModal({ series: item, episodes: cachedEpisodes, index: null });
      return;
    }
    showLoadingModal('Carregando episódios...');
    const loading = modalRoot.firstElementChild;
    try {
      const episodes = await getSeriesEpisodesCached(item);
      if (!isCurrent() || modalRoot.firstElementChild !== loading) return;
      closeModal();
      if (!episodes?.length) return toast('Nenhum episódio disponível.');
      openSeriesContextModal({ series: item, episodes, index: null });
    } catch (error) {
      if (isCurrent() && modalRoot.firstElementChild === loading) throw error;
    } finally {
      if (modalRoot.firstElementChild === loading) closeModal();
    }
    return;
  }
  return requestPlayback(item);
}

async function openPlayer(item, { preservePreviousView = false, seriesContext = null, reconnecting = false, startFromBeginning = false, fullscreen = false, automaticEpisode = false } = {}) {
  const accountId = state.activeAccount?.id;
  const profileId = activeProfileId();
  const catalogSession = catalogSessionVersion;
  if (!(await authorizeParentalPlayback(item))) return;
  if (accountId !== state.activeAccount?.id || profileId !== activeProfileId()
      || catalogSession !== catalogSessionVersion || isTitleBlocked(state.activeProfile, item)) return;
  setDiscoverFullscreen(false);
  disposeDiscover();
  if (!automaticEpisode) inactivityGuard.interact();
  const sessionVersion = beginPlayerSession();
  if (item.kind === 'series' && seriesContext && state.lastView === 'series') preserveSeriesCatalogView();
  cancelLiveReconnect({ resetAttempts: !reconnecting });
  clearLiveWebStallWatch();
  await stopPlaybackTracking();
  if (!isPlayerSessionCurrent(sessionVersion)) return;
  await player.stop();
  if (!isPlayerSessionCurrent(sessionVersion)) return;
  playbackEndedHandled = false;
  creditsPromptShown = false;
  if (item.kind === 'series') {
    if (seriesContext) currentSeriesContext = seriesContext;
    else {
      const matchesCurrentContext = currentSeriesContext?.episodes?.some(episode => String(episode.id) === String(item.id));
      if (!matchesCurrentContext) currentSeriesContext = null;
    }
  } else {
    currentSeriesContext = null;
  }
  if (!preservePreviousView && state.lastView !== 'player') previousView = state.lastView;
  state.lastView = 'player';
  currentPlayerItem = item;
  root.replaceChildren(cloneTemplate('player-template'));
  document.body.classList.toggle('desktop-player', isDesktopPlayer());
  bindDesktopPlayerControls(item);
  document.body.classList.toggle('live-player-fullscreen', ['live', 'vod', 'series', 'catchup'].includes(item.kind));
  qs('#player-title').textContent = item.name || 'Conteúdo';
  qs('#player-subtitle').textContent = item.kind === 'live'
    ? 'TV ao vivo'
    : item.kind === 'vod'
      ? 'Filme'
      : item.kind === 'radio'
        ? 'Rádio'
        : item.kind === 'catchup'
          ? `TV atrasada${item.channelName ? ` • ${item.channelName}` : ''}`
          : 'Série';
  qs('#player-back').onclick = () => {
    if (item.kind === 'series' && currentSeriesContext?.series) return returnToCurrentSeries().catch(handleError);
    navigate(previousView || item.kind).catch(handleError);
  };
  syncPlayerFavoriteButton();
  const speedButton = qs('#player-speed');
  speedButton.classList.toggle('hidden', !['vod', 'series'].includes(item.kind));
  speedButton.disabled = true;
  speedButton.onclick = () => openPlayerSpeedMenu();
  const video = qs('#video-player');
  currentPlayerVideo = video;
  video.style.objectFit = state.settings.videoSize;
  if (isTvDevice()) video.removeAttribute('controls');
  bindCinemaControls(item, video);
  const message = qs('#player-message');
  try {
    const playback = item.kind === 'live'
      ? await getLivePlayback(item)
      : await window.desktopAPI.playback.get(item, state.settings.streamType);
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return;
    await player.play(video, playback);
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return;
    syncPlayerSpeedButton();
    cinemaControls?.refresh();
    if (item.kind === 'live') {
      hideLiveRecovery();
      message.classList.add('hidden');
      watchLiveWebStalls(video);
      markLivePlaybackStable();
      const items = liveChannels();
      const index = itemIndex(items, item);
      if (index >= 0) primeNearbyLivePlayback(items, index);
      showLiveZapOverlay(item, cachedLiveEpg(item));
      loadNowPlaying(item, sessionVersion, video).catch(() => {});
    } else if (isSeekableKind(item.kind)) {
      if (shouldPersistPlayback(item.kind)) {
        if (startFromBeginning) await player.seek(video, 0);
        else await restorePlaybackProgress(item, video);
        if (!isPlayerSessionMatch(sessionVersion, item, video)) return;
      }
      startPlaybackTracking(item, video);
    }
    if (fullscreen && isPlayerSessionMatch(sessionVersion, item, video)) setDiscoverFullscreen(true);
  } catch (error) {
    if (!isPlayerSessionMatch(sessionVersion, item, video)) return;
    await report('warn', `Falha de reprodução (${item.kind}/${item.id}): ${error.message}`);
    message.textContent = `Não foi possível iniciar este conteúdo. ${error.message}`;
    message.classList.remove('hidden');
    if (item.kind === 'live') scheduleLiveReconnect(error.message);
  }
}

async function loadNowPlaying(item, sessionVersion = playerSessionVersion, video = currentPlayerVideo) {
  const [row] = await loadLiveEpg([item]);
  if (!isPlayerSessionMatch(sessionVersion, item, video)) return;
  showLiveZapOverlay(item, row);
  if (!row?.now) return;
  const container = qs('#now-program');
  container.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = `Agora • ${liveProgramTime(row.now)}: ${row.now.title || 'Programação'}`;
  container.append(strong);
  if (row.now.description) {
    const detail = document.createElement('small');
    detail.textContent = row.now.description;
    container.append(document.createElement('br'), detail);
  }
  if (row.next) {
    const next = document.createElement('small');
    next.textContent = `Próximo • ${liveProgramTime(row.next)}: ${row.next.title || 'Programação'}`;
    container.append(document.createElement('br'), next);
  }
}

async function refreshAll() {
  if (state.refreshInProgress) return toast('Uma atualização já está em andamento.');
  if (!state.activeAccount) return openAccounts();
  state.refreshInProgress = true;
  invalidateCatalogSession();
  const session = catalogSessionVersion;
  showLoadingModal('Atualizando conteúdos', 'TV, filmes, séries e rádio serão substituídos somente após uma atualização completa.');
  const loadingModal = modalRoot.firstElementChild;
  try {
    const result = await window.desktopAPI.catalog.refreshAll();
    if (session !== catalogSessionVersion) return;
    clearContentDetailCaches();
    clearPreservedSeriesCatalogView();
    resetLoadedCatalogs();
    homeRecommendationsRequest = null;
    state.summary = { ...state.summary, ...(result.counts || {}) };
    state.accountState = 'online';
    if (modalRoot.firstElementChild === loadingModal) closeModal();
    renderHomeView();
    toast('Conteúdo atualizado com sucesso.');
  } catch (error) {
    if (session !== catalogSessionVersion) return;
    state.accountState = /senha|autent|recusad/i.test(error.message) ? 'authentication_error' : 'offline';
    if (modalRoot.firstElementChild === loadingModal) closeModal();
    throw error;
  } finally {
    if (modalRoot.firstElementChild === loadingModal) closeModal();
    state.refreshInProgress = false;
  }
}

function profilePinFailureKey(profile) {
  return `${profile?.accountId || ''}:${profile?.id || ''}`;
}

function pinLockRemainingSeconds(profile) {
  const record = profilePinFailures.get(profilePinFailureKey(profile));
  if (!record?.lockUntil) return 0;
  return Math.max(0, Math.ceil((record.lockUntil - Date.now()) / 1000));
}

async function validateProfilePin(profile, pin) {
  const key = profilePinFailureKey(profile);
  const lockedSeconds = pinLockRemainingSeconds(profile);
  if (lockedSeconds > 0) throw new Error(`Muitas tentativas. Aguarde ${lockedSeconds}s.`);
  const valid = await verifyProfilePin(profile, pin);
  if (valid) {
    profilePinFailures.delete(key);
    return true;
  }
  const previous = profilePinFailures.get(key) || { attempts: 0, lockUntil: 0 };
  const attempts = previous.attempts + 1;
  if (attempts >= PROFILE_PIN_MAX_ATTEMPTS) {
    profilePinFailures.set(key, { attempts: 0, lockUntil: Date.now() + PROFILE_PIN_LOCK_MS });
    throw new Error('PIN incorreto. Perfil bloqueado por 30 segundos.');
  }
  profilePinFailures.set(key, { attempts, lockUntil: 0 });
  throw new Error(`PIN incorreto. Restam ${PROFILE_PIN_MAX_ATTEMPTS - attempts} tentativas.`);
}

async function authorizeParentalPlayback(item) {
  if (isTitleBlocked(state.activeProfile, item)) { toast('Este título está bloqueado neste perfil.'); return false; }
  if (!isRestrictedForActiveProfile(item)) return true;
  const profile = state.activeProfile;
  if (!profile) return false;
  if (profile.kidsMode) {
    toast('Este conteúdo não está disponível no perfil infantil.');
    return false;
  }
  const unlockKey = `${profile.accountId || ''}:${profile.id || ''}`;
  if ((parentalUnlockUntil.get(unlockKey) || 0) > Date.now()) return true;
  if (!hasProfilePin(profile)) {
    toast('Defina um PIN neste perfil para liberar conteúdo restrito.');
    return false;
  }
  return new Promise(resolve => {
    openProfilePinModal(profile, {
      message: 'Digite o PIN para liberar este conteúdo por 10 minutos.',
      onSubmit: async pin => {
        await validateProfilePin(profile, pin);
        parentalUnlockUntil.set(unlockKey, Date.now() + PARENTAL_UNLOCK_MS);
        closeModal();
        resolve(true);
      },
      onCancel: () => {
        closeModal();
        resolve(false);
      }
    });
  });
}

function activateProfile(profile) {
  state.activeProfile = profile;
  state.profileState = setRememberedProfile(state.profileState, state.activeAccount.id, profile.id);
  saveProfiles(state.profileState);
  document.body.classList.remove('profile-selection');
  document.body.classList.remove('account-login');
  state.lastView = 'home';
  previousView = 'home';
  renderHomeView();
}

function authorizeProfile(profile, onAuthorized) {
  if (!profile) return toast('Perfil não encontrado.');
  if (!hasProfilePin(profile)) return onAuthorized?.();
  openProfilePinModal(profile, {
    onSubmit: async pin => {
      await validateProfilePin(profile, pin);
      closeModal();
      return onAuthorized?.();
    }
  });
}

function selectProfile(profileId) {
  if (!state.activeAccount) return openAccounts();
  const profile = profilesForAccount(state.profileState, state.activeAccount.id)
    .find(value => value.id === String(profileId || ''));
  if (!profile) return toast('Perfil não encontrado.');
  authorizeProfile(profile, () => activateProfile(profile));
}

function openProfileEditor(profile = null, { returnToManager = false } = {}) {
  if (!state.activeAccount) return openAccounts();
  openProfileEditorModal(profile, {
    onSave: async draft => {
      if (!draft.name) throw new Error('Informe um nome para o perfil.');
      if (profile?.id) {
        const result = updateProfile(state.profileState, state.activeAccount.id, profile.id, draft);
        state.profileState = result.state;
        if (state.activeProfile?.id === result.profile.id) state.activeProfile = result.profile;
      } else {
        const result = addProfile(state.profileState, state.activeAccount.id, draft);
        state.profileState = result.state;
      }
      saveProfiles(state.profileState);
      if (returnToManager) openProfileManager();
      else openProfiles({ switching: true });
    }
  });
}

function saveProfilePin(profile, protection) {
  if (!state.activeAccount || !profile) return null;
  const result = updateProfile(state.profileState, state.activeAccount.id, profile.id, protection);
  state.profileState = result.state;
  if (state.activeProfile?.id === result.profile.id) state.activeProfile = result.profile;
  saveProfiles(state.profileState);
  return result.profile;
}

function openProfilePinSettings(profile) {
  if (!state.activeAccount || !profile) return;
  openProfilePinSetupModal(profile, {
    onSave: async pin => {
      const protection = await createProfilePin(pin);
      saveProfilePin(profile, protection);
      openProfileManager();
      toast('PIN do perfil salvo.');
    },
    onRemove: async () => {
      saveProfilePin(profile, { pinHash: '', pinSalt: '', pinIterations: 0 });
      profilePinFailures.delete(profilePinFailureKey(profile));
      openProfileManager();
      toast('PIN removido do perfil.');
    }
  });
}

function deleteProfile(profileId) {
  if (!state.activeAccount) return;
  const accountId = state.activeAccount.id;
  state.profileState = removeProfile(state.profileState, accountId, profileId);
  state.favorites = migrateFavorites(state.favorites.filter(item => !(item.accountId === accountId && item.profileId === profileId)));
  state.history = migrateHistory(state.history.filter(entry => !(entry.accountId === accountId && entry.profileId === profileId)));
  if (state.activeProfile?.id === profileId) state.activeProfile = rememberedProfile(state.profileState, accountId);
  saveProfiles(state.profileState);
  saveFavorites(state.favorites);
  saveHistory(state.history);
  openProfileManager();
  toast('Perfil excluído.');
}

function updateProfileBlocks(profile, item, blocked) {
  if (!state.activeAccount || profile.accountId !== state.activeAccount.id) return null;
  const result = updateProfile(state.profileState, profile.accountId, profile.id, {
    blockedTitles: blocked ? blockTitle(profile.blockedTitles, item) : unblockTitle(profile.blockedTitles, item)
  });
  state.profileState = result.state;
  if (state.activeProfile?.id === result.profile.id) state.activeProfile = result.profile;
  homeDerivedCache = null;
  clearPreservedSeriesCatalogView();
  saveProfiles(state.profileState);
  return result.profile;
}

function openBlockedManager(profileId) {
  const accountId = state.activeAccount?.id;
  const profile = profilesForAccount(state.profileState, accountId).find(row => row.id === profileId);
  if (!profile) return;
  openBlockedTitlesModal(profile, {
    onUnblock: item => {
      if (state.activeAccount?.id !== accountId) return;
      updateProfileBlocks(profile, item, false);
      openBlockedManager(profileId);
    },
    onDone: openProfileManager
  });
}

function openProfileManager() {
  if (!state.activeAccount) return openAccounts();
  closeModal();
  document.body.classList.remove('account-login');
  document.body.classList.remove('live-player-fullscreen');
  document.body.classList.add('profile-selection');
  state.lastView = 'profiles-manager';
  const profiles = profilesForAccount(state.profileState, state.activeAccount.id);
  renderProfileManager(state.activeAccount, profiles, {
    onEdit: id => {
      const profile = profiles.find(value => value.id === id) || null;
      authorizeProfile(profile, () => openProfileEditor(profile, { returnToManager: true }));
    },
    onBlocked: id => {
      const profile = profiles.find(value => value.id === id) || null;
      authorizeProfile(profile, () => openBlockedManager(id));
    },
    onPin: id => {
      const profile = profiles.find(value => value.id === id) || null;
      authorizeProfile(profile, () => openProfilePinSettings(profile));
    },
    onDelete: id => {
      const profile = profiles.find(value => value.id === id) || null;
      authorizeProfile(profile, () => deleteProfile(id));
    },
    onAdd: () => openProfileEditor(null, { returnToManager: true }),
    onDone: () => openProfiles({ switching: true })
  });
}

function openProfiles({ switching = false } = {}) {
  disposeDiscover();
  if (!state.activeAccount) return openAccounts();
  closeModal();
  document.body.classList.remove('account-login');
  document.body.classList.remove('live-player-fullscreen');
  document.body.classList.add('profile-selection');
  state.lastView = 'profiles';
  const profiles = profilesForAccount(state.profileState, state.activeAccount.id);
  renderProfilePicker(state.activeAccount, profiles, {
    activeProfileId: switching ? activeProfileId() : '',
    onSelect: selectProfile,
    onAdd: () => openProfileEditor(null),
    onManage: openProfileManager,
    onAccount: openAccounts
  });
}

function openAccounts() {
  const fullPage = isTvDevice();
  document.body.classList.remove('profile-selection');
  if (fullPage) {
    closeModal();
    document.body.classList.remove('live-player-fullscreen');
    document.body.classList.add('account-login');
    state.lastView = 'accounts';
  }
  openAccountModal(state, {
    onSave: async draft => {
      if (!(await changeAccount(() => window.desktopAPI.accounts.save(draft)))) return false;
      state.accountState = 'online';
      openProfiles();
      toast('Conta conectada nesta aba.');
    },
    onActivate: async id => {
      if (!(await changeAccount(() => window.desktopAPI.accounts.activate(id)))) return;
      openProfiles();
      toast('Conta alterada.');
    },
    onRemove: async id => {
      if (!(await changeAccount(() => window.desktopAPI.accounts.remove(id)))) return;
      if (!state.activeAccount) openAccounts();
      else openProfiles();
      toast('Conta removida.');
    }
  }, fullPage ? { container: root, fullPage: true, onClose: renderHomeView } : undefined);
}

function openBackups() {
  openBackupModal(state, {
    onExport: () => window.desktopAPI.backup.export({ version: 6, ratings: exportRatings(localStorage), favorites: state.favorites, history: state.history, settings: state.settings, profiles: exportableProfileState(state.profileState) }),
    onImport: async () => {
      const data = await window.desktopAPI.backup.import();
      if (!data) return false;
      importRatings(localStorage, data.ratings);
      profileRatingCache = null;
      homeDerivedCache = null;
      state.favorites = migrateFavorites(data.favorites || []);
      state.history = migrateHistory(data.history || []);
      state.profileState = migrateProfileState(data.profiles || state.profileState);
      state.profileState = ensureProfilesForAccounts(state.profileState, state.accounts);
      state.activeProfile = state.activeAccount ? rememberedProfile(state.profileState, state.activeAccount.id) : null;
      state.settings = { ...state.settings, ...(data.settings || {}) };
      saveFavorites(state.favorites);
      saveHistory(state.history);
      saveProfiles(state.profileState);
      saveSettings(state.settings);
      migrateLegacyProfileData();
      return true;
    }
  });
}

async function runDiagnostics(button) {
  const label = button.querySelector('small');
  const start = performance.now();
  label.textContent = 'Testando cache/API...';
  try {
    const catalog = await ensureCatalog('live', { quiet: true });
    const ms = Math.round(performance.now() - start);
    label.textContent = `${catalog.items.length} canais • ${ms} ms`;
  } catch (error) {
    label.textContent = 'Falhou';
    throw error;
  }
}

init();
