import { esc } from './dom.mjs';
export function mountSimilar(container, { related = [], onRelated } = {}) {
  if (!container || !related.length || !onRelated) return;
  const section = document.createElement('section');
  section.className = 'similar-section';
  section.setAttribute('aria-label', 'Mais títulos semelhantes');
  section.innerHTML = `<h3>Mais títulos semelhantes</h3><div class="similar-grid">${related.map((item, index) =>
    `<button class="similar-card" data-related="${index}">${item.image ? `<img src="${esc(item.image)}" loading="lazy" decoding="async" alt="" referrerpolicy="no-referrer">` : '<span class="similar-placeholder">▶</span>'}<strong>${esc(item.name)}</strong></button>`).join('')}</div>`;
  for (const button of section.querySelectorAll('[data-related]')) button.onclick = () => onRelated(related[Number(button.dataset.related)]);
  container.append(section);
}
