import { modalRoot, closeModal } from './dom.mjs';
export function openSpeedModal({ rates, current = 1, onSelect, isCurrent = () => true } = {}) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal speed-modal" role="dialog" aria-modal="true" aria-labelledby="speed-title"><h2 id="speed-title">Velocidade de reprodução</h2><div class="speed-options"></div><p data-speed-error role="status"></p><div class="form-actions"><button class="btn" data-close>Fechar</button></div></section></div>`;
  const panel = modalRoot.firstElementChild;
  for (const rate of rates || []) {
    const button = document.createElement('button');
    button.className = 'btn'; button.type = 'button'; button.dataset.speed = String(rate);
    button.textContent = `${rate.toLocaleString('pt-BR')}×${rate === 1 ? ' (normal)' : ''}`;
    button.setAttribute('aria-pressed', String(rate === current));
    if (rate === current) button.dataset.tvAutofocus = '';
    button.onclick = async () => {
      if (!isCurrent() || !panel.isConnected) return;
      button.disabled = true;
      try { await onSelect(rate); if (isCurrent() && panel.isConnected) closeModal(); }
      catch { if (panel.isConnected) panel.querySelector('[data-speed-error]').textContent = 'Não foi possível alterar a velocidade neste player.'; }
      finally { button.disabled = false; }
    };
    panel.querySelector('.speed-options').append(button);
  }
  panel.querySelector('[data-close]').onclick = closeModal;
}
