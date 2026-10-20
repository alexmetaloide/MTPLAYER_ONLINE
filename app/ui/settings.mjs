import { root, cloneTemplate, qs, qsa } from './dom.mjs';

export function renderSettings(state, { onChange }) {
  root.replaceChildren(cloneTemplate('settings-template'));
  qs('#video-size-label').textContent = state.settings.videoSize === 'contain' ? 'Ajustar à tela' : 'Preencher tela';
  const labels = { auto: 'Automático', hls: 'Priorizar HLS', original: 'Original/TS' };
  qs('#stream-type-label').textContent = labels[state.settings.streamType] || 'Automático';
  const pageLabel = qs('#page-size-label');
  const nextEpisodeLabel = qs('#next-episode-label');
  const samsungTv = document.documentElement.classList.contains('tizen-tv');
  if (pageLabel) pageLabel.textContent = samsungTv ? '24 por lote (TV)' : `${state.settings.pageSize} itens`;
  if (nextEpisodeLabel) nextEpisodeLabel.textContent = `${state.settings.nextEpisodeSeconds || 90}s antes do fim`;

  qsa('[data-setting="videoSize"]').forEach(button => button.onclick = () => {
    state.settings.videoSize = state.settings.videoSize === 'contain' ? 'cover' : 'contain';
    onChange();
  });
  qsa('[data-setting="streamType"]').forEach(button => button.onclick = () => {
    const order = ['auto', 'hls', 'original'];
    state.settings.streamType = order[(order.indexOf(state.settings.streamType) + 1) % order.length];
    onChange();
  });
  qsa('[data-setting="pageSize"]').forEach(button => {
    if (samsungTv) {
      button.disabled = true;
      return;
    }
    button.onclick = () => {
    const values = [80, 120, 180, 240];
    state.settings.pageSize = values[(values.indexOf(state.settings.pageSize) + 1) % values.length];
    onChange();
    };
  });
  qsa('[data-setting="nextEpisodeSeconds"]').forEach(button => button.onclick = () => {
    const values = [60, 90, 120];
    const current = Number(state.settings.nextEpisodeSeconds) || 90;
    state.settings.nextEpisodeSeconds = values[(values.indexOf(current) + 1) % values.length];
    onChange();
  });
}
