import { loadSettings, loadRawFavorites, loadRawHistory, loadRawProfiles, saveFavorites, saveHistory, saveProfiles } from './storage.mjs';
import { migrateFavorites } from './favorites.mjs';
import { migrateHistory } from './history.mjs';
import { migrateProfileState } from './profiles.mjs';

export function createState() {
  const favorites = migrateFavorites(loadRawFavorites());
  const history = migrateHistory(loadRawHistory());
  const profileState = migrateProfileState(loadRawProfiles());
  saveFavorites(favorites);
  saveHistory(history);
  saveProfiles(profileState);
  return {
    appInfo: { version: '', platform: '', portable: false },
    accounts: [],
    activeAccount: null,
    activeProfile: null,
    profileState,
    accountState: 'disconnected',
    summary: { live: 0, vod: 0, series: 0, radio: 0 },
    catalogs: {
      live: { categories: [], items: [], loaded: false, stale: false },
      vod: { categories: [], items: [], loaded: false, stale: false },
      series: { categories: [], items: [], loaded: false, stale: false },
      radio: { categories: [], items: [], loaded: false, stale: false }
    },
    favorites,
    history,
    settings: loadSettings(),
    lastView: 'home',
    refreshInProgress: false,
    player: null
  };
}

export function activeFavorites(state) {
  const id = state.activeAccount?.id || '';
  const profileId = state.activeProfile?.id || '';
  return state.favorites.filter(item => item.accountId === id && item.profileId === profileId);
}

export function resetCatalogs(state) {
  for (const kind of Object.keys(state.catalogs)) {
    state.catalogs[kind] = { categories: [], items: [], loaded: false, stale: false };
  }
}
