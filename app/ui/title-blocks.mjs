import { modalRoot, closeModal, esc } from './dom.mjs';
export function mountBlockButton(container, item, { onBlock } = {}) {
  if (!container || !onBlock) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn block-title-button'; button.dataset.blockTitle = '';
  button.textContent = '⊘ Bloquear neste perfil';
  button.onclick = () => onBlock(item);
  container.append(button);
}
export function openBlockedTitlesModal(profile, { onUnblock, onDone } = {}) {
  const rows = profile.blockedTitles || [];
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal blocked-titles-modal" role="dialog" aria-modal="true" aria-label="Títulos bloqueados">
    <h2>Títulos bloqueados — ${esc(profile.name)}</h2>
    <p>O bloqueio vale apenas para este perfil, incluindo episódios e outras edições identificadas do mesmo título.</p>
    <div class="blocked-titles-list">${rows.length ? rows.map((item, i) => `<div class="blocked-title-row"><span><strong>${esc(item.name)}</strong><small>${item.kind === 'series' ? 'Série' : 'Filme'}${item.year ? ` • ${esc(item.year)}` : ''}</small></span><button class="btn" data-unblock="${i}">Desbloquear</button></div>`).join('') : '<p>Nenhum título bloqueado. Abra os detalhes de um filme ou série para bloquear.</p>'}</div>
    <div class="form-actions"><button class="btn primary" data-done data-tv-autofocus>Concluir</button></div>
  </section></div>`;
  for (const button of modalRoot.querySelectorAll('[data-unblock]')) button.onclick = () => onUnblock?.(rows[Number(button.dataset.unblock)]);
  modalRoot.querySelector('[data-done]').onclick = () => { closeModal(); onDone?.(); };
}
