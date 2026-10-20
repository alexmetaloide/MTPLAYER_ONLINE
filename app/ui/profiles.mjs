import { root, modalRoot, qs, qsa, esc, closeModal, toast } from './dom.mjs';
import { MAX_PROFILES_PER_ACCOUNT, PROFILE_AVATARS, playbackPreferences } from '../core/profiles.mjs';
import { hasProfilePin } from '../core/profile-pin.mjs';

function initial(name) {
  return String(name || 'P').trim().charAt(0).toUpperCase() || 'P';
}

function avatar(profile, className = 'profile-avatar') {
  return `<span class="${className} avatar-${esc(profile.avatar || 'blue')}">${esc(initial(profile.name))}</span>`;
}

export function renderProfilePicker(account, profiles, { activeProfileId = '', onSelect, onAdd, onManage, onAccount } = {}) {
  const rows = Array.isArray(profiles) ? profiles : [];
  root.innerHTML = `<section class="profile-screen">
    <div class="profile-brand"><img src="assets/mtplayer-logo.jpg" alt=""><span>MTPLAYER</span></div>
    <h1>Quem está assistindo?</h1>
    <p class="profile-account">${esc(account?.name || 'Lista IPTV')} • cada perfil mantém seu próprio histórico e favoritos</p>
    <div class="profile-grid">
      ${rows.map((profile, index) => `<button class="profile-card${profile.id === activeProfileId ? ' active' : ''}" data-profile-id="${esc(profile.id)}" ${index === 0 ? 'data-tv-autofocus' : ''}>
        ${avatar(profile)}
        <strong>${hasProfilePin(profile) ? '🔒 ' : ''}${esc(profile.name)}</strong>
        ${profile.id === activeProfileId ? '<small>Perfil atual</small>' : `<small>${hasProfilePin(profile) ? 'PIN necessário' : 'Entrar'}</small>`}
      </button>`).join('')}
      ${rows.length < MAX_PROFILES_PER_ACCOUNT ? `<button class="profile-card profile-add" data-add-profile ${rows.length ? '' : 'data-tv-autofocus'}>
        <span class="profile-avatar profile-avatar-add">＋</span>
        <strong>Adicionar perfil</strong>
        <small>${rows.length}/${MAX_PROFILES_PER_ACCOUNT} perfis</small>
      </button>` : ''}
    </div>
    <div class="profile-footer-actions">
      <button class="btn" data-manage-profiles>✎ Gerenciar perfis</button>
      <button class="btn" data-profile-account>♙ Conta IPTV</button>
    </div>
  </section>`;

  qsa('[data-profile-id]', root).forEach(button => {
    button.onclick = () => onSelect?.(button.dataset.profileId);
  });
  qs('[data-add-profile]', root)?.addEventListener('click', () => onAdd?.());
  qs('[data-manage-profiles]', root)?.addEventListener('click', () => onManage?.());
  qs('[data-profile-account]', root)?.addEventListener('click', () => onAccount?.());
}

export function renderProfileManager(account, profiles, { onEdit, onPin, onDelete, onAdd, onDone, onBlocked } = {}) {
  const rows = Array.isArray(profiles) ? profiles : [];
  root.innerHTML = `<section class="profile-screen profile-manager-screen">
    <div class="profile-brand"><img src="assets/mtplayer-logo.jpg" alt=""><span>MTPLAYER</span></div>
    <h1>Gerenciar perfis</h1>
    <p class="profile-account">${esc(account?.name || 'Lista IPTV')} • até ${MAX_PROFILES_PER_ACCOUNT} perfis</p>
    <div class="profile-manager-list">
      ${rows.map((profile, index) => `<div class="profile-manager-row">
        ${avatar(profile, 'profile-avatar profile-avatar-small')}
        <div class="profile-manager-copy"><strong>${hasProfilePin(profile) ? '🔒 ' : ''}${esc(profile.name)}</strong><small>${profile.kidsMode ? 'Perfil infantil • conteúdo +18 oculto' : `${hasProfilePin(profile) ? 'PIN ativo • ' : ''}Histórico, progresso e favoritos separados`}</small></div>
        <button class="btn" data-edit-profile="${esc(profile.id)}" ${index === 0 ? 'data-tv-autofocus' : ''}>Editar</button>
        <button class="btn" data-blocked-profile="${esc(profile.id)}">Títulos bloqueados (${profile.blockedTitles?.length || 0})</button>
        <button class="btn" data-pin-profile="${esc(profile.id)}">${hasProfilePin(profile) ? 'Alterar PIN' : 'Definir PIN'}</button>
        <button class="btn danger" data-delete-profile="${esc(profile.id)}" ${rows.length <= 1 ? 'disabled' : ''}>Excluir</button>
      </div>`).join('')}
    </div>
    <div class="profile-footer-actions">
      ${rows.length < MAX_PROFILES_PER_ACCOUNT ? '<button class="btn" data-add-profile>＋ Adicionar perfil</button>' : ''}
      <button class="btn primary" data-profile-done>Concluir</button>
    </div>
  </section>`;
  qsa('[data-edit-profile]', root).forEach(button => button.onclick = () => onEdit?.(button.dataset.editProfile));
  qsa('[data-blocked-profile]', root).forEach(button => button.onclick = () => onBlocked?.(button.dataset.blockedProfile));
  qsa('[data-pin-profile]', root).forEach(button => button.onclick = () => onPin?.(button.dataset.pinProfile));
  qsa('[data-delete-profile]', root).forEach(button => {
    let confirmTimer = null;
    button.onclick = () => {
      if (button.dataset.confirmDelete === '1') {
        if (confirmTimer) clearTimeout(confirmTimer);
        onDelete?.(button.dataset.deleteProfile);
        return;
      }
      button.dataset.confirmDelete = '1';
      button.textContent = 'Confirmar';
      confirmTimer = setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.confirmDelete = '0';
        button.textContent = 'Excluir';
      }, 4000);
    };
  });
  qs('[data-add-profile]', root)?.addEventListener('click', () => onAdd?.());
  qs('[data-profile-done]', root)?.addEventListener('click', () => onDone?.());
}

function pinDots(value) {
  const count = String(value || '').length;
  return `${'●'.repeat(count)}${'○'.repeat(Math.max(0, 4 - count))}`;
}

function pinKeypad({ onDigit, onBackspace, onSubmit }) {
  return `<div class="pin-keypad">
    ${['1','2','3','4','5','6','7','8','9'].map((digit, index) => `<button type="button" data-pin-digit="${digit}" ${index === 0 ? 'data-tv-autofocus' : ''}>${digit}</button>`).join('')}
    <button type="button" data-pin-back aria-label="Apagar">⌫</button>
    <button type="button" data-pin-digit="0">0</button>
    <button type="button" data-pin-submit aria-label="Confirmar PIN">OK</button>
  </div>`;
}

function bindPinKeypad(container, state, { onSubmit } = {}) {
  const display = qs('[data-pin-display]', container);
  const message = qs('[data-pin-message]', container);
  const render = () => { if (display) display.textContent = pinDots(state.value); };
  qsa('[data-pin-digit]', container).forEach(button => {
    button.onclick = () => {
      if (state.busy || state.value.length >= 4) return;
      state.value += button.dataset.pinDigit;
      if (message) message.textContent = '';
      render();
    };
  });
  qs('[data-pin-back]', container).onclick = () => {
    if (state.busy) return;
    state.value = state.value.slice(0, -1);
    if (message) message.textContent = '';
    render();
  };
  qs('[data-pin-submit]', container).onclick = async () => {
    if (state.busy) return;
    if (state.value.length !== 4) {
      if (message) message.textContent = 'Digite os 4 números do PIN.';
      return;
    }
    state.busy = true;
    try {
      await onSubmit?.(state.value, { display, message, reset: () => { state.value = ''; render(); } });
    } finally {
      state.busy = false;
    }
  };
  render();
}

export function openProfilePinModal(profile, { onSubmit, onCancel = closeModal, message = 'Digite o PIN de 4 dígitos para acessar este perfil.' } = {}) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal profile-pin-modal" role="dialog" aria-modal="true" aria-label="PIN do perfil">
    <div class="profile-pin-lock">🔒</div>
    <h2>${esc(profile?.name || 'Perfil')}</h2>
    <p>${esc(message)}</p>
    <div class="profile-pin-display" data-pin-display>○○○○</div>
    <div class="profile-pin-message" data-pin-message></div>
    ${pinKeypad({})}
    <div class="form-actions"><button type="button" class="btn" data-pin-cancel>Cancelar</button></div>
  </div></div>`;
  const state = { value: '', busy: false };
  bindPinKeypad(modalRoot, state, {
    onSubmit: async (pin, controls) => {
      try {
        await onSubmit?.(pin);
      } catch (error) {
        controls.reset();
        if (controls.message) controls.message.textContent = error?.message || 'PIN incorreto.';
      }
    }
  });
  qs('[data-pin-cancel]', modalRoot).onclick = onCancel;
}

export function openProfilePinSetupModal(profile, { onSave, onRemove, onCancel = closeModal } = {}) {
  const protectedProfile = hasProfilePin(profile);
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal profile-pin-modal" role="dialog" aria-modal="true" aria-label="Configurar PIN">
    <div class="profile-pin-lock">${protectedProfile ? '🔒' : '🔐'}</div>
    <h2>${protectedProfile ? 'Alterar PIN' : 'Definir PIN'} • ${esc(profile?.name || 'Perfil')}</h2>
    <p data-pin-step-text>Digite um novo PIN de 4 dígitos.</p>
    <div class="profile-pin-display" data-pin-display>○○○○</div>
    <div class="profile-pin-message" data-pin-message></div>
    ${pinKeypad({})}
    <div class="form-actions">
      ${protectedProfile ? '<button type="button" class="btn danger" data-remove-pin>Remover PIN</button>' : ''}
      <button type="button" class="btn" data-pin-cancel>Cancelar</button>
    </div>
  </div></div>`;
  const state = { value: '', busy: false, firstPin: '' };
  bindPinKeypad(modalRoot, state, {
    onSubmit: async (pin, controls) => {
      const stepText = qs('[data-pin-step-text]', modalRoot);
      if (!state.firstPin) {
        state.firstPin = pin;
        controls.reset();
        if (stepText) stepText.textContent = 'Digite o mesmo PIN novamente para confirmar.';
        if (controls.message) controls.message.textContent = '';
        return;
      }
      if (pin !== state.firstPin) {
        state.firstPin = '';
        controls.reset();
        if (stepText) stepText.textContent = 'Digite um novo PIN de 4 dígitos.';
        if (controls.message) controls.message.textContent = 'Os PINs não coincidem. Tente novamente.';
        return;
      }
      await onSave?.(pin);
      closeModal();
    }
  });
  const removeButton = qs('[data-remove-pin]', modalRoot);
  if (removeButton) removeButton.onclick = async () => {
    removeButton.disabled = true;
    try {
      await onRemove?.();
      closeModal();
    } catch (error) {
      removeButton.disabled = false;
      toast(error?.message || 'Não foi possível remover o PIN.');
    }
  };
  qs('[data-pin-cancel]', modalRoot).onclick = onCancel;
}

export function openProfileEditorModal(profile, { onSave } = {}) {
  const editing = Boolean(profile?.id);
  const preferences = playbackPreferences(profile);
  const currentAvatar = PROFILE_AVATARS.includes(profile?.avatar) ? profile.avatar : PROFILE_AVATARS[0];
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal profile-editor-modal">
    <h2>${editing ? 'Editar perfil' : 'Adicionar perfil'}</h2>
    <p>${editing ? 'Altere o nome ou o avatar deste perfil.' : 'Este perfil terá histórico, progresso e favoritos próprios.'}</p>
    <form id="profile-form" class="form-grid">
      <label>Nome do perfil<input name="name" maxlength="40" value="${esc(profile?.name || '')}" placeholder="Ex.: Alex" required data-tv-autofocus></label>
      <div class="profile-avatar-picker" aria-label="Escolher avatar">
        ${PROFILE_AVATARS.map(avatarName => `<button type="button" class="avatar-choice avatar-${avatarName}${avatarName === currentAvatar ? ' selected' : ''}" data-avatar="${avatarName}" aria-label="Avatar ${avatarName}">${esc(initial(profile?.name || 'P'))}</button>`).join('')}
      </div>
      <label class="profile-kids-toggle"><input type="checkbox" name="kidsMode" ${profile?.kidsMode ? 'checked' : ''}><span><strong>Perfil infantil</strong><small>Oculta automaticamente categorias e itens identificados como conteúdo +18.</small></span></label>
      <fieldset class="profile-playback"><legend>Reprodução deste perfil</legend>
        <label><input type="checkbox" name="previews" ${preferences.previews ? 'checked' : ''}> Mostrar prévias ao passar o mouse</label>
        <label><input type="checkbox" name="previewAutoplay" ${preferences.previewAutoplay ? 'checked' : ''}> Iniciar o título após a prévia</label>
        <label><input type="checkbox" name="nextEpisodeAutoplay" ${preferences.nextEpisodeAutoplay ? 'checked' : ''}> Iniciar próximo episódio automaticamente</label>
        <label><input type="checkbox" name="inactivityCheck" ${preferences.inactivityCheck ? 'checked' : ''}> Perguntar se há alguém assistindo após três episódios sem interação</label>
      </fieldset>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary">${editing ? 'Salvar' : 'Criar perfil'}</button></div>
    </form>
  </div></div>`;
  let selectedAvatar = currentAvatar;
  const nameInput = qs('input[name="name"]', modalRoot);
  const refreshInitials = () => {
    const letter = initial(nameInput?.value || 'P');
    qsa('[data-avatar]', modalRoot).forEach(button => { button.textContent = letter; });
  };
  nameInput?.addEventListener('input', refreshInitials);
  qsa('[data-avatar]', modalRoot).forEach(button => {
    button.onclick = () => {
      selectedAvatar = button.dataset.avatar;
      qsa('[data-avatar]', modalRoot).forEach(value => value.classList.toggle('selected', value === button));
    };
  });
  qs('[data-close]', modalRoot).onclick = closeModal;
  qs('#profile-form', modalRoot).onsubmit = async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await onSave?.({ name: String(nameInput?.value || '').trim(), avatar: selectedAvatar, kidsMode: Boolean(qs('input[name="kidsMode"]', modalRoot)?.checked), playback: { previews: qs('[name="previews"]', modalRoot).checked, previewAutoplay: qs('[name="previewAutoplay"]', modalRoot).checked, nextEpisodeAutoplay: qs('[name="nextEpisodeAutoplay"]', modalRoot).checked, inactivityCheck: qs('[name="inactivityCheck"]', modalRoot).checked } });
      closeModal();
    } catch (error) {
      submit.disabled = false;
      toast(error.message || 'Não foi possível salvar o perfil.');
    }
  };
}
