import { esc } from '../core/utils.mjs';

export const root = document.getElementById('view-root');
export const modalRoot = document.getElementById('modal-root');
export const qs = (selector, element = document) => element.querySelector(selector);
export const qsa = (selector, element = document) => [...element.querySelectorAll(selector)];
export const cloneTemplate = id => document.getElementById(id).content.cloneNode(true);
export { esc };

export function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = String(message || '');
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
}

export function closeModal() {
  const active = document.activeElement;
  if (active && modalRoot.contains(active)) active.blur?.();
  modalRoot.replaceChildren();
}

export function showLoadingModal(title, detail = 'Por favor, aguarde.') {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>${esc(title)}</h2><p>${esc(detail)}</p><div class="progress-bar indeterminate"><i></i></div></div></div>`;
}
