import { root, cloneTemplate, qs, qsa, esc } from './dom.mjs';
import { debounce, formatDateTime } from '../core/utils.mjs';

function supportsCatchup(channel) {
  return Boolean(channel?.kind === 'live' || channel?.tvArchive || Number(channel?.tvArchiveDuration) > 0 || channel?.catchup || channel?.catchupAvailable);
}

function rowHtml(channel, epg, index, allowCatchup) {
  const now = epg?.now;
  const next = epg?.next;
  return `<div class="epg-row-wrap">
    <button class="epg-row" data-stream="${esc(channel.id)}" data-page-index="${index}">
      <div class="epg-channel">${channel.image ? `<img src="${esc(channel.image)}" alt="" loading="lazy">` : '<span>▣</span>'}<strong>${esc(channel.name)}</strong></div>
      <div class="epg-program"><small>AGORA ${now?.start ? `• ${formatDateTime(now.start)}` : ''}</small><strong>${esc(now?.title || 'Programação indisponível')}</strong><span>${esc(now?.description || '')}</span></div>
      <div class="epg-program next"><small>PRÓXIMO ${next?.start ? `• ${formatDateTime(next.start)}` : ''}</small><strong>${esc(next?.title || '—')}</strong></div>
    </button>
    ${allowCatchup && supportsCatchup(channel) ? `<button class="epg-catchup" data-catchup-index="${index}">↶ TV atrasada</button>` : ''}
  </div>`;
}

export async function renderEpgView(catalog, { getEpg, onOpen, onCatchup = null }) {
  root.replaceChildren(cloneTemplate('epg-template'));
  const list = qs('#epg-list');
  const status = qs('#epg-status');
  let term = '';
  let visible = 40;
  let epgMap = new Map();
  let requestVersion = 0;
  let visibleChannels = [];
  const indexedChannels = (catalog.items || []).map(channel => ({
    channel,
    name: String(channel.name || '').toLocaleLowerCase('pt-BR')
  }));

  const filtered = () => {
    const normalized = term.toLocaleLowerCase('pt-BR');
    return indexedChannels.filter(entry => !normalized || entry.name.includes(normalized)).map(entry => entry.channel);
  };

  const renderRows = channels => {
    visibleChannels = channels;
    list.innerHTML = channels.map((channel, index) => rowHtml(channel, epgMap.get(String(channel.id)), index, Boolean(onCatchup))).join('');
  };

  list.onclick = event => {
    const catchupButton = event.target.closest('[data-catchup-index]');
    if (catchupButton && list.contains(catchupButton)) {
      const channel = visibleChannels[Number(catchupButton.dataset.catchupIndex)];
      if (channel) onCatchup?.(channel);
      return;
    }
    const button = event.target.closest('.epg-row');
    if (!button || !list.contains(button)) return;
    const channel = visibleChannels[Number(button.dataset.pageIndex)];
    if (channel) onOpen(channel);
  };

  async function update(loadEpg = true) {
    const version = ++requestVersion;
    const matches = filtered();
    const channels = matches.slice(0, visible);
    renderRows(channels);
    qs('#epg-more').classList.toggle('hidden', visible >= matches.length);
    if (!loadEpg || !channels.length) return;
    const unresolved = channels.filter(channel => !epgMap.has(String(channel.id)));
    if (!unresolved.length) {
      status.textContent = `${channels.length} canais exibidos`;
      return;
    }
    status.textContent = 'Carregando programação...';
    try {
      const data = await getEpg(unresolved.map(channel => ({ id: channel.id, tvgId: channel.tvgId || '', name: channel.name || '' })));
      if (version !== requestVersion) return;
      for (const row of data || []) epgMap.set(String(row.streamId), row);
      renderRows(channels);
      status.textContent = data?.length ? `${channels.length} canais exibidos` : 'EPG detalhado não disponível para esta fonte.';
    } catch (error) {
      status.textContent = `EPG indisponível: ${error.message}`;
    }
  }

  qs('#epg-search').oninput = debounce(event => { term = event.target.value; visible = 40; update(true); }, 200);
  qs('#epg-more').onclick = () => { visible += 40; update(true); };
  await update(true);
}
