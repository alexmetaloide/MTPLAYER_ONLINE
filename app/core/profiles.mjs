import { sanitizeBlockedTitles } from './title-blocks.mjs';
export const MAX_PROFILES_PER_ACCOUNT = 5;

export const PROFILE_AVATARS = Object.freeze([
  'blue',
  'yellow',
  'purple',
  'orange',
  'pink'
]);

function clean(value, max = 80) {
  return String(value ?? '').trim().slice(0, max);
}

export function defaultProfileId(accountId) {
  return `default:${clean(accountId, 80)}`;
}

export function playbackPreferences(profile) {
  const value = profile?.playback || {};
  return { previews: value.previews !== false, previewAutoplay: value.previewAutoplay !== false,
    nextEpisodeAutoplay: value.nextEpisodeAutoplay !== false, inactivityCheck: value.inactivityCheck !== false };
}

export function sanitizeProfile(value = {}) {
  const accountId = clean(value.accountId, 80);
  const id = clean(value.id, 140);
  if (!accountId || !id) return null;
  const avatar = PROFILE_AVATARS.includes(value.avatar) ? value.avatar : PROFILE_AVATARS[0];
  const pinHash = clean(value.pinHash, 200);
  const pinSalt = clean(value.pinSalt, 100);
  const pinIterations = Math.min(Math.max(Number(value.pinIterations) || 0, 0), 500000);
  return {
    id,
    accountId,
    name: clean(value.name || 'Perfil', 40) || 'Perfil',
    avatar,
    kidsMode: Boolean(value.kidsMode),
    playback: playbackPreferences(value),
    blockedTitles: sanitizeBlockedTitles(value.blockedTitles),
    pinHash: pinHash && pinSalt && pinIterations ? pinHash : '',
    pinSalt: pinHash && pinSalt && pinIterations ? pinSalt : '',
    pinIterations: pinHash && pinSalt && pinIterations ? pinIterations : 0,
    createdAt: Math.max(0, Number(value.createdAt) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}

export function migrateProfileState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const profiles = (Array.isArray(source.profiles) ? source.profiles : [])
    .map(sanitizeProfile)
    .filter(Boolean);
  const seen = new Set();
  const uniqueProfiles = profiles.filter(profile => {
    const key = `${profile.accountId}:${profile.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const activeByAccount = {};
  if (source.activeByAccount && typeof source.activeByAccount === 'object') {
    for (const [accountId, profileId] of Object.entries(source.activeByAccount)) {
      const account = clean(accountId, 80);
      const profile = clean(profileId, 140);
      if (account && profile) activeByAccount[account] = profile;
    }
  }
  return { version: 1, profiles: uniqueProfiles, activeByAccount };
}

export function profilesForAccount(profileState, accountId) {
  const target = clean(accountId, 80);
  if (!target) return [];
  return migrateProfileState(profileState).profiles.filter(profile => profile.accountId === target);
}

export function ensureProfilesForAccounts(profileState, accounts = []) {
  const next = migrateProfileState(profileState);
  const accountIds = new Set((Array.isArray(accounts) ? accounts : []).map(account => clean(account?.id, 80)).filter(Boolean));
  // Web credentials expire with the tab session. Keep local profiles so the
  // same account can reconnect without losing PINs, blocks or preferences.
  for (const accountId of accountIds) {
    let profiles = next.profiles.filter(profile => profile.accountId === accountId);
    if (!profiles.length) {
      const now = Date.now();
      next.profiles.push({
        id: defaultProfileId(accountId),
        accountId,
        name: 'Perfil 1',
        avatar: PROFILE_AVATARS[0],
        kidsMode: false,
        createdAt: now,
        updatedAt: now
      });
      profiles = next.profiles.filter(profile => profile.accountId === accountId);
    }
    const activeId = next.activeByAccount[accountId];
    if (!profiles.some(profile => profile.id === activeId)) next.activeByAccount[accountId] = profiles[0].id;
  }
  return next;
}

export function rememberedProfile(profileState, accountId) {
  const state = migrateProfileState(profileState);
  const activeId = state.activeByAccount[clean(accountId, 80)];
  return state.profiles.find(profile => profile.accountId === clean(accountId, 80) && profile.id === activeId) || null;
}

export function setRememberedProfile(profileState, accountId, profileId) {
  const state = migrateProfileState(profileState);
  const account = clean(accountId, 80);
  const id = clean(profileId, 140);
  const profile = state.profiles.find(value => value.accountId === account && value.id === id);
  if (!profile) return state;
  state.activeByAccount[account] = id;
  return state;
}

function createProfileId(accountId) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${clean(accountId, 80)}:profile:${Date.now().toString(36)}:${random}`;
}

export function addProfile(profileState, accountId, draft = {}) {
  const state = migrateProfileState(profileState);
  const account = clean(accountId, 80);
  const existing = state.profiles.filter(profile => profile.accountId === account);
  if (!account) throw new Error('Conta IPTV inválida.');
  if (existing.length >= MAX_PROFILES_PER_ACCOUNT) throw new Error(`Limite de ${MAX_PROFILES_PER_ACCOUNT} perfis atingido.`);
  const now = Date.now();
  const profile = sanitizeProfile({
    id: createProfileId(account),
    accountId: account,
    name: draft.name || `Perfil ${existing.length + 1}`,
    avatar: draft.avatar,
    kidsMode: Boolean(draft.kidsMode),
    playback: draft.playback,
    blockedTitles: draft.blockedTitles,
    createdAt: now,
    updatedAt: now
  });
  state.profiles.push(profile);
  return { state, profile };
}

export function updateProfile(profileState, accountId, profileId, draft = {}) {
  const state = migrateProfileState(profileState);
  const account = clean(accountId, 80);
  const id = clean(profileId, 140);
  const index = state.profiles.findIndex(profile => profile.accountId === account && profile.id === id);
  if (index < 0) throw new Error('Perfil não encontrado.');
  const current = state.profiles[index];
  const updated = sanitizeProfile({
    ...current,
    name: draft.name ?? current.name,
    avatar: draft.avatar ?? current.avatar,
    kidsMode: draft.kidsMode ?? current.kidsMode,
    playback: draft.playback ?? current.playback,
    blockedTitles: draft.blockedTitles ?? current.blockedTitles,
    pinHash: draft.pinHash ?? current.pinHash,
    pinSalt: draft.pinSalt ?? current.pinSalt,
    pinIterations: draft.pinIterations ?? current.pinIterations,
    updatedAt: Date.now()
  });
  state.profiles[index] = updated;
  return { state, profile: updated };
}

export function exportableProfileState(profileState) {
  const state = migrateProfileState(profileState);
  return {
    version: 1,
    profiles: state.profiles.map(profile => ({
      id: profile.id,
      accountId: profile.accountId,
      name: profile.name,
      avatar: profile.avatar,
      kidsMode: Boolean(profile.kidsMode),
      playback: playbackPreferences(profile),
      blockedTitles: sanitizeBlockedTitles(profile.blockedTitles),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    })),
    activeByAccount: { ...state.activeByAccount }
  };
}

export function removeProfile(profileState, accountId, profileId) {
  const state = migrateProfileState(profileState);
  const account = clean(accountId, 80);
  const id = clean(profileId, 140);
  const accountProfiles = state.profiles.filter(profile => profile.accountId === account);
  if (accountProfiles.length <= 1) throw new Error('A conta precisa ter pelo menos um perfil.');
  if (!accountProfiles.some(profile => profile.id === id)) throw new Error('Perfil não encontrado.');
  state.profiles = state.profiles.filter(profile => !(profile.accountId === account && profile.id === id));
  if (state.activeByAccount[account] === id) {
    state.activeByAccount[account] = state.profiles.find(profile => profile.accountId === account)?.id || '';
  }
  return state;
}
