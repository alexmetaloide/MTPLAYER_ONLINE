import { modalRoot, closeModal } from './dom.mjs';
export function openInactivityModal({ onContinue, onStop, isCurrent = () => true } = {}) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal inactivity-modal" role="dialog" aria-modal="true" aria-labelledby="inactivity-title">
    <h2 id="inactivity-title">Tem alguém assistindo?</h2>
    <p>A reprodução automática está pausada. Quer continuar com o próximo episódio?</p>
    <div class="form-actions"><button class="btn" data-stop>Parar por aqui</button><button class="btn primary" data-continue data-tv-autofocus>Sim, continuar</button></div>
  </section></div>`;
  modalRoot.querySelector('[data-continue]').onclick = () => {
    const valid = isCurrent();
    closeModal();
    if (valid) onContinue?.();
  };
  modalRoot.querySelector('[data-stop]').onclick = () => { closeModal(); onStop?.(); };
}
