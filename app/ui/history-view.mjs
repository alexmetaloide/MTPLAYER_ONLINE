import { root, cloneTemplate, qs, qsa, esc } from './dom.mjs';
import { activeHistory, filterHistoryEntries, searchHistoryEntries, historyProgressPercent, formatPlaybackTime } from '../core/history.mjs';

function historyCard(entry, index) {
  const percent = entry.completed ? 100 : historyProgressPercent(entry);
  const image = entry.item.image || '';
  const status = entry.completed
    ? 'Assistido'
    : entry.duration
      ? `${percent}% • ${formatPlaybackTime(entry.position)} de ${formatPlaybackTime(entry.duration)}`
      : `Parou em ${formatPlaybackTime(entry.position)}`;

  return `<article class="history-card">
    <button class="history-open" data-history-open="${index}" aria-label="Abrir ${esc(entry.item.name || 'conteúdo')}">
      <div class="continue-poster">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span>▶</span>'}
        <div class="continue-progress"><i style="width:${percent}%"></i></div>
      </div>
      <div class="continue-meta"><strong>${esc(entry.item.name || 'Conteúdo')}</strong><small>${esc(status)}</small></div>
    </button>
    <div class="history-actions">
      <button data-history-restart="${index}" title="Assistir desde o início">↺ Recomeçar</button>
      <button data-history-remove="${index}" title="Remover do histórico">× Remover</button>
    </div>
  </article>`;
}

export function renderHistoryView(state, { onOpen, onRestart, onRemove, onClear } = {}) {
  root.replaceChildren(cloneTemplate('history-template'));
  const allEntries = activeHistory(state.history, state.activeAccount?.id, state.activeProfile?.id || '');
  const grid = qs('#history-grid');
  const empty = qs('#history-empty');
  const emptyTitle = empty?.querySelector('strong');
  const emptyText = empty?.querySelector('span');
  const count = qs('#history-count');
  const clear = qs('#history-clear');
  const search = qs('#history-search');
  const filters = qsa('[data-history-filter]');
  let currentFilter = 'all';
  let currentQuery = '';
  let clearTimer = null;

  function bindCards(entries) {
    qsa('[data-history-open]', grid).forEach(button => {
      button.onclick = () => onOpen?.(entries[Number(button.dataset.historyOpen)]);
    });
    qsa('[data-history-restart]', grid).forEach(button => {
      button.onclick = () => onRestart?.(entries[Number(button.dataset.historyRestart)]);
    });
    qsa('[data-history-remove]', grid).forEach(button => {
      button.onclick = () => onRemove?.(entries[Number(button.dataset.historyRemove)]);
    });
  }

  function renderFiltered() {
    const filtered = filterHistoryEntries(allEntries, currentFilter);
    const entries = searchHistoryEntries(filtered, currentQuery);
    count.textContent = entries.length === 1 ? '1 item' : `${entries.length} itens`;
    filters.forEach(button => button.classList.toggle('active', button.dataset.historyFilter === currentFilter));

    if (!entries.length) {
      grid.replaceChildren();
      empty.classList.remove('hidden');
      if (emptyTitle) emptyTitle.textContent = allEntries.length ? 'Nenhum item encontrado' : 'Nenhum histórico ainda';
      if (emptyText) emptyText.textContent = allEntries.length
        ? 'Tente outro nome ou ajuste o filtro.'
        : 'Filmes e episódios assistidos aparecerão aqui.';
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = entries.map(historyCard).join('');
    bindCards(entries);
  }

  filters.forEach(button => {
    button.onclick = () => {
      currentFilter = button.dataset.historyFilter || 'all';
      renderFiltered();
    };
  });

  search?.addEventListener('input', () => {
    currentQuery = search.value || '';
    renderFiltered();
  });

  if (!allEntries.length) clear?.classList.add('hidden');

  if (clear) {
    clear.onclick = () => {
      if (clear.dataset.confirm === '1') {
        if (clearTimer) clearTimeout(clearTimer);
        onClear?.();
        return;
      }

      clear.dataset.confirm = '1';
      clear.classList.add('confirming');
      clear.textContent = 'Confirmar limpeza';
      clearTimer = setTimeout(() => {
        clear.dataset.confirm = '0';
        clear.classList.remove('confirming');
        clear.textContent = 'Limpar histórico';
      }, 4000);
    };
  }

  renderFiltered();
}
