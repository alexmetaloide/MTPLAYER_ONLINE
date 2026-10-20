// Keep connection feedback inside the dialog, not behind its backdrop.
export function bindAccountForm(form, { getType, onSave, onSuccess, typeButtons = [] }) {
  const submit = form.querySelector('[type="submit"]');
  const status = form.querySelector('[data-account-status]');
  function showStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = false;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
  }
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = 'Conectando…';
    form.setAttribute('aria-busy', 'true');
    typeButtons.forEach(button => { button.disabled = true; });
    showStatus('Validando seu acesso. Aguarde: a resposta do provedor pode levar até 45 segundos.', 'pending');
    try {
      const values = new FormData(form);
      const type = getType();
      const draft = { type, name: String(values.get('name') || '').trim() || 'Minha lista' };
      if (type === 'xtream') {
        Object.assign(draft, {
          server: String(values.get('server') || '').trim(),
          username: String(values.get('username') || '').trim(),
          password: String(values.get('password') || '')
        });
      } else {
        draft.url = String(values.get('url') || '').trim();
        const file = values.get('playlistFile');
        if (file?.size) {
          if (file.size > 50 * 1024 * 1024) throw new Error('A playlist excede 50 MB.');
          draft.playlistText = await file.text();
        }
      }
      if (await onSave(draft) === false) throw new Error('Outra alteração de conta está em andamento. Aguarde e tente novamente.');
      onSuccess?.();
    } catch (error) {
      showStatus(error?.message || 'Não foi possível conectar. Confira os dados e tente novamente.', 'error');
      status.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      status.focus?.({ preventScroll: true });
    } finally {
      submit.disabled = false;
      submit.textContent = 'Conectar nesta aba';
      form.setAttribute('aria-busy', 'false');
      typeButtons.forEach(button => { button.disabled = false; });
    }
  };
}
