import { mountBlockButton } from './title-blocks.mjs';
import { bindAccountForm } from './account-form.mjs';
import { mountSimilar } from './similar.mjs';
import { mountRatings } from './ratings.mjs';
import { modalRoot, qs, qsa, esc, closeModal, toast } from './dom.mjs';

function accountStatus(account) {
  if (!account) return '';
  const parts = [account.type === 'xtream' ? 'Xtream' : 'M3U'];
  if (account.expiresAt) parts.push(`vence ${new Intl.DateTimeFormat('pt-BR').format(new Date(account.expiresAt))}`);
  if (account.maxConnections != null) parts.push(`${account.activeConnections ?? 0}/${account.maxConnections} conexões`);
  return parts.join(' • ');
}

export function openAccountModal(state, { onSave, onActivate, onRemove }, { container = modalRoot, fullPage = false, onClose = closeModal } = {}) {
  const activeId = state.activeAccount?.id || '';
  container.innerHTML = `<div class="${fullPage ? 'account-login-screen' : 'modal-backdrop'}"><div class="modal wide${fullPage ? ' account-login-card' : ''}">
    ${fullPage ? '<div class="login-brand"><img src="assets/mtplayer-logo.jpg" alt=""><span>MTPLAYER</span></div>' : ''}
    <h2>${fullPage && !activeId ? 'Configure sua conta' : 'Contas IPTV'}</h2><p>MTPLAYER Web · conecte sua própria lista autorizada.</p>
    <div class="web-notice"><strong>Antes de conectar</strong><p>O provedor precisa permitir HTTPS e acesso pelo navegador (CORS). Contas e links privados ficam somente na sessão desta aba, sem criptografia de armazenamento; o navegador pode restaurar sessões. Favoritos e histórico ficam neste dispositivo. Não use em computador compartilhado. Nenhuma conta é enviada ao GitHub.</p></div>
    ${!fullPage || state.accounts.length ? `<div class="account-list">
      ${state.accounts.length ? state.accounts.map(account => `<div class="account-row ${account.id === activeId ? 'active' : ''}">
        <button class="account-select" data-account="${esc(account.id)}"><strong>${esc(account.name)}</strong><small>${esc(accountStatus(account))}</small></button>
        <button class="btn danger compact" data-remove-account="${esc(account.id)}" title="Remover conta">×</button>
      </div>`).join('') : '<div class="empty-inline">Nenhuma conta cadastrada.</div>'}
    </div>
    <hr class="modal-separator">
    <h3>Adicionar conta</h3>` : ''}
    <p class="tv-form-hint">Na TV: use as setas para escolher um campo e pressione OK para abrir o teclado.</p>
    <div class="panel-types"><button type="button" data-type="xtream" data-tv-autofocus class="active"><strong>Xtream Codes API</strong><small>Servidor + usuário + senha</small></button><button type="button" data-type="m3u"><strong>M3U URL</strong><small>Link completo da playlist</small></button></div>
    <form id="account-form" class="form-grid">
      <label>Nome da lista<input name="name" value="Minha lista" maxlength="120" required></label>
       <div id="xtream-fields" class="form-grid"><label>Servidor / Portal (HTTPS)<input name="server" placeholder="https://servidor:porta" autocomplete="off"></label><label>Usuário<input name="username" autocomplete="off"></label><label>Senha<input name="password" type="password" autocomplete="off"></label></div>
       <div id="m3u-fields" class="form-grid hidden"><label>URL M3U (HTTPS)<input name="url" placeholder="https://servidor/get.php?..." autocomplete="off"></label><label>Ou abrir arquivo M3U local<input name="playlistFile" type="file" accept=".m3u,.m3u8,text/plain,audio/x-mpegurl"></label><small>O arquivo não é enviado a um servidor. Seus streams ainda precisam ser compatíveis com o navegador.</small></div>
       <p class="account-status" data-account-status role="status" aria-live="polite" aria-atomic="true" tabindex="-1" hidden></p>
       <div class="form-actions">${!fullPage || activeId ? '<button type="button" class="btn" data-close>Voltar</button>' : ''}<button type="submit" class="btn primary">Conectar nesta aba</button></div>
    </form>
  </div></div>`;

  let selectedType = 'xtream';
  qsa('[data-type]', container).forEach(button => button.onclick = () => {
    selectedType = button.dataset.type;
    qsa('[data-type]', container).forEach(value => value.classList.toggle('active', value === button));
    qs('#xtream-fields', container).classList.toggle('hidden', selectedType !== 'xtream');
    qs('#m3u-fields', container).classList.toggle('hidden', selectedType !== 'm3u');
  });
  qsa('[data-account]', container).forEach(button => button.onclick = async () => {
    if (button.dataset.account === activeId) return onClose();
    button.disabled = true;
    try { await onActivate(button.dataset.account); if (!fullPage) closeModal(); } catch (error) { button.disabled = false; toast(error.message); }
  });
  qsa('[data-remove-account]', container).forEach(button => button.onclick = async event => {
    event.stopPropagation();
    button.disabled = true;
    try {
      await onRemove(button.dataset.removeAccount);
      if (!fullPage) closeModal();
    } catch (error) { button.disabled = false; toast(error.message); }
  });
  const closeButton = qs('[data-close]', container);
  if (closeButton) closeButton.onclick = onClose;
   bindAccountForm(qs('#account-form', container), {
     getType: () => selectedType,
     onSave,
     onSuccess: () => { if (!fullPage) closeModal(); },
     typeButtons: qsa('[data-type]', container)
   });

  // TVs Samsung não movem o foco automaticamente para conteúdo criado
  // dinamicamente. Deixe o primeiro botão do modal pronto para o controle.
  const loginForm = qs('#account-form', container);
  const focusLogin = () => {
    if (!loginForm.isConnected || container.contains(document.activeElement)) return;
    qs('[data-tv-autofocus]', container)?.focus({ preventScroll: true });
  };
  setTimeout(focusLogin, 0);
  setTimeout(focusLogin, 120);
  setTimeout(focusLogin, 400);
}

export function openBackupModal(state, { onExport, onImport }) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>Backup e restauração</h2><p>O backup contém perfis, preferências, favoritos e histórico de reprodução sanitizados. Credenciais, URLs privadas e PINs dos perfis não são exportados.</p><div class="form-actions"><button class="btn" id="restore-backup">Restaurar</button><button class="btn primary" id="save-backup">Salvar backup</button><button class="btn" data-close>Fechar</button></div></div></div>`;
  qs('[data-close]', modalRoot).onclick = closeModal;
  qs('#save-backup', modalRoot).onclick = async () => {
    try { if (await onExport()) toast('Backup salvo.'); } catch (error) { toast(error.message); }
  };
  qs('#restore-backup', modalRoot).onclick = async () => {
    try { if (await onImport()) { closeModal(); toast('Backup restaurado.'); } } catch (error) { toast(error.message); }
  };
}

export function openSupportModal(state, capabilities) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>MTPLAYER Web</h2><p>Versão ${esc(state.appInfo.version || '—')} · navegador</p><div class="support-grid"><span>HLS</span><strong>${capabilities.hls ? 'Disponível' : 'Carregado ao reproduzir'}</strong><span>MPEG-TS/MSE</span><strong>${capabilities.mpegTs ? 'Disponível' : 'Depende do navegador'}</strong><span>Catálogo</span><strong>Cache em memória</strong><span>Contas</span><strong>Sessão desta aba</strong></div><p>Sem player nativo ou proxy. CORS, HTTPS e codecs dependem do provedor e do navegador.</p><div class="form-actions"><button class="btn" data-close>Fechar</button></div></div></div>`;
  qs('[data-close]', modalRoot).onclick = closeModal;
}

export function openMovieModal(movie, onPlay, options = {}) {
  const backdrop = movie.backdrop || movie.image || '';
  const release = movie.releaseDate || movie.year || '';
  const metadata = [release, movie.genre, movie.duration].filter(Boolean);
  const plot = String(movie.plot || '').trim() || 'Sinopse não disponível para este filme.';

  modalRoot.innerHTML = `<div class="series-detail-backdrop">
    <section class="series-detail movie-detail" role="dialog" aria-modal="true" aria-label="Detalhes do filme ${esc(movie.name || '')}">
      ${backdrop ? `<img class="series-detail-bg" src="${esc(backdrop)}" alt="" referrerpolicy="no-referrer">` : ''}
      <div class="series-detail-shade"></div>
      <button class="series-detail-close" data-close aria-label="Voltar">← Voltar</button>
      <div class="series-detail-scroll">
        <header class="series-hero">
          <div class="series-poster">${movie.image ? `<img src="${esc(movie.image)}" alt="Capa de ${esc(movie.name || '')}" referrerpolicy="no-referrer">` : '<span>▶</span>'}</div>
          <div class="series-info">
            <h2>${esc(movie.name || 'Filme')}</h2>
            <div class="series-rating">${movie.rating ? `<strong>★ ${esc(movie.rating)}</strong>` : ''}${metadata.map(value => `<span>${esc(value)}</span>`).join('')}</div>
            ${movie.cast ? `<p class="series-cast">Elenco: ${esc(movie.cast)}</p>` : ''}
            ${movie.director ? `<p class="series-director">Direção: ${esc(movie.director)}</p>` : ''}
            <p class="series-plot">${esc(plot)}</p>
            <div class="movie-detail-actions"><button class="btn primary" data-watch data-tv-autofocus>▶ Assistir</button></div>
          </div>
        </header>
      </div>
    </section>
  </div>`;

  qs('[data-close]', modalRoot).onclick = closeModal;
  mountRatings(qs('.movie-detail-actions', modalRoot), movie, options);
  mountBlockButton(qs('.movie-detail-actions', modalRoot), movie, options);
  mountSimilar(qs('.series-detail-scroll', modalRoot), options);
  qs('[data-watch]', modalRoot).onclick = () => {
    closeModal();
    onPlay(movie);
  };
}

export function openResumePlaybackModal(item, positionLabel, { onResume, onRestart } = {}) {
  const contentType = item?.kind === 'series' ? 'episódio' : 'filme';
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal resume-playback-modal" role="dialog" aria-modal="true" aria-label="Retomar reprodução">
    <div class="episode-complete-status">CONTINUAR ASSISTINDO</div>
    <h2>${esc(item?.name || 'Conteúdo')}</h2>
    <p>Você parou este ${contentType} em <strong>${esc(positionLabel)}</strong>. Deseja retomar de onde parou ou começar do início?</p>
    <div class="form-actions resume-playback-actions">
      <button class="btn" data-restart>↺ Assistir do início</button>
      <button class="btn primary" data-resume data-tv-autofocus>▶ Retomar de ${esc(positionLabel)}</button>
    </div>
  </div></div>`;
  qs('[data-resume]', modalRoot).onclick = () => {
    closeModal();
    onResume?.();
  };
  qs('[data-restart]', modalRoot).onclick = () => {
    closeModal();
    onRestart?.();
  };
}

function catchupTimeLabel(program) {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const start = program?.start ? formatter.format(new Date(program.start)) : 'Horário indisponível';
  const end = program?.end ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(program.end)) : '';
  return end ? `${start}–${end}` : start;
}

export function openCatchupModal(channel, programs, { onPlay } = {}) {
  const rows = Array.isArray(programs) ? programs : [];
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal wide catchup-modal" role="dialog" aria-modal="true" aria-label="TV atrasada">
    <div class="episode-complete-status">TV ATRASADA</div>
    <h2>${esc(channel?.name || 'Canal')}</h2>
    <p>Escolha um programa anterior disponível no servidor.</p>
    <div class="catchup-list">
      ${rows.map((program, index) => `<button class="catchup-program" data-catchup-program="${index}" ${index === 0 ? 'data-tv-autofocus' : ''}>
        <span>${esc(catchupTimeLabel(program))}</span>
        <strong>${esc(program.title || 'Programação')}</strong>
        <small>${esc(program.description || 'Sem descrição.')}</small>
        <b>▶ Assistir</b>
      </button>`).join('')}
    </div>
    <div class="form-actions"><button class="btn" data-close>Fechar</button></div>
  </div></div>`;
  qsa('[data-catchup-program]', modalRoot).forEach(button => {
    button.onclick = () => onPlay?.(rows[Number(button.dataset.catchupProgram)]);
  });
  qs('[data-close]', modalRoot).onclick = closeModal;
}

function seasonNumber(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function episodeLabel(episode) {
  const number = episode.episode || '—';
  const season = episode.season || '—';
  return `EPISÓDIO Nº: ${number}   TEMPORADA: ${season}`;
}

function episodeTitle(series, episode) {
  const season = String(episode.season || '1').padStart(2, '0');
  const number = String(episode.episode || '1').padStart(2, '0');
  const title = episode.name || `Episódio ${episode.episode || ''}`;
  return `${series.name || 'Série'} - S${season}E${number} - ${title}`;
}

export function openEpisodeModal(series, episodes, onOpen, { isWatched = () => false, getProgress = () => 0, initialEpisodeIndex = 0, getRating, onRate, related, onRelated, onBlock } = {}) {
  const grouped = new Map();
  episodes.forEach((episode, index) => {
    const season = String(episode.season || '1');
    if (!grouped.has(season)) grouped.set(season, []);
    grouped.get(season).push({ episode, index });
  });
  const seasons = [...grouped.keys()].sort((a, b) => seasonNumber(a) - seasonNumber(b) || a.localeCompare(b));
  const firstSeason = seasons[0] || '1';
  const selectedEpisode = episodes[initialEpisodeIndex] || episodes[0];
  const initialSeason = String(selectedEpisode?.season || firstSeason);
  const backdrop = series.backdrop || series.image || '';
  const release = series.releaseDate || series.year || '';
  const metadata = [release, series.genre].filter(Boolean);

  modalRoot.innerHTML = `<div class="series-detail-backdrop">
    <section class="series-detail" role="dialog" aria-modal="true" aria-label="Detalhes da série ${esc(series.name || '')}">
      ${backdrop ? `<img class="series-detail-bg" src="${esc(backdrop)}" alt="" referrerpolicy="no-referrer">` : ''}
      <div class="series-detail-shade"></div>
      <button class="series-detail-close" data-close aria-label="Voltar">← Voltar</button>
      <div class="series-detail-scroll">
        <header class="series-hero">
          <div class="series-poster">${series.image ? `<img src="${esc(series.image)}" alt="Capa de ${esc(series.name || '')}" referrerpolicy="no-referrer">` : '<span>▶</span>'}</div>
          <div class="series-info">
            <h2>${esc(series.name || 'Série')}</h2>
            <div class="series-rating">${series.rating ? `<strong>★ ${esc(series.rating)}</strong>` : ''}${metadata.map(value => `<span>${esc(value)}</span>`).join('')}</div>
            ${series.cast ? `<p class="series-cast">${esc(series.cast)}</p>` : ''}
            ${series.director ? `<p class="series-director">Direção: ${esc(series.director)}</p>` : ''}
            ${series.plot ? `<p class="series-plot">${esc(series.plot)}</p>` : ''}
          </div>
        </header>
        <nav class="season-tabs" aria-label="Temporadas">
          ${seasons.map(season => `<button class="season-tab ${season === initialSeason ? 'active' : ''}" data-season="${esc(season)}">TEMPORADA ${esc(season)}</button>`).join('')}
        </nav>
        <div class="series-episode-list" data-episode-list></div>
      </div>
    </section>
  </div>`;

  const list = qs('[data-episode-list]', modalRoot);
  const renderSeason = season => {
    const rows = grouped.get(season) || [];
    list.innerHTML = rows.map(({ episode, index }) => {
      const watched = Boolean(isWatched(episode));
      const progress = watched ? 100 : Math.min(99, Math.max(0, Number(getProgress(episode)) || 0));
      const status = watched
        ? '<b class="episode-watched">✓ ASSISTIDO</b>'
        : progress > 0 ? `<b class="episode-progress-label">${progress}% ASSISTIDO</b>` : '';
      return `<button class="series-episode-row${watched ? ' watched' : ''}" data-episode="${index}">
      <div class="series-episode-heading"><strong>${esc(episodeTitle(series, episode))}</strong>${status}</div>
      ${episode.plot ? `<p>${esc(episode.plot)}</p>` : ''}
      <span>${esc(episodeLabel(episode))}</span>
      ${!watched && progress > 0 ? `<div class="episode-progress-mini" aria-label="${progress}% assistido"><i style="width:${progress}%"></i></div>` : ''}
    </button>`;
    }).join('');
    qsa('[data-episode]', list).forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.episode);
        const episode = episodes[index];
        closeModal();
        onOpen(episode, index);
      };
    });
  };

  qsa('[data-season]', modalRoot).forEach(button => {
    button.onclick = () => {
      qsa('[data-season]', modalRoot).forEach(value => value.classList.toggle('active', value === button));
      renderSeason(button.dataset.season);
    };
  });
  qs('[data-close]', modalRoot).onclick = closeModal;
  mountRatings(qs('.series-info', modalRoot), series, { getRating, onRate });
  mountBlockButton(qs('.series-info', modalRoot), series, { onBlock });
  mountSimilar(qs('.series-detail-scroll', modalRoot), { related, onRelated });
  renderSeason(initialSeason);
  setTimeout(() => {
    const target = list.querySelector(`[data-episode="${initialEpisodeIndex}"]`);
    if (!target) return;
    target.classList.add('resume-target');
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    try { target.scrollIntoView({ block: 'center' }); } catch { target.scrollIntoView(); }
  }, 0);
}

export function openNextEpisodeModal(currentEpisode, nextEpisode, { onNext, mode = 'ended', autoplay = true, isCurrent = () => true } = {}) {
  const hasNext = Boolean(nextEpisode);
  const counting = hasNext && autoplay && mode === 'ended';
  let countdown = 10;
  modalRoot.innerHTML = `<section class="next-episode-panel" data-next-episode-prompt role="region" aria-label="Próximo episódio">
    <h2>${mode === 'ended' ? 'Episódio concluído' : 'Próximo episódio disponível'}</h2>
    <p>${hasNext ? esc(nextEpisode.name || 'Próximo episódio') : 'Este foi o último episódio disponível.'}</p>
    ${counting ? '<div class="next-episode-countdown">Começa em <strong data-next-countdown>10</strong>s</div>' : ''}
    <div class="form-actions"><button class="btn" data-close>${mode === 'ended' ? 'Agora não' : 'Continuar este episódio'}</button>
    ${hasNext ? '<button class="btn primary" data-next data-tv-autofocus>▶ Assistir próximo</button>' : ''}</div>
  </section>`;
  const panel = modalRoot.firstElementChild;
  let timer = null;
  let started = false;
  const stop = () => { clearInterval(timer); timer = null; };
  const start = automatic => {
    if (started || !panel.isConnected || !isCurrent()) { stop(); return; }
    started = true;
    stop();
    closeModal();
    onNext?.(nextEpisode, { automatic });
  };
  panel.querySelector('[data-close]').onclick = () => { stop(); closeModal(); };
  const next = panel.querySelector('[data-next]');
  if (next) next.onclick = () => start(false);
  if (counting) timer = setInterval(() => {
    if (!panel.isConnected || !isCurrent()) return stop();
    if (document.hidden) return;
    countdown -= 1;
    panel.querySelector('[data-next-countdown]').textContent = String(countdown);
    if (countdown <= 0) start(true);
  }, 1000);
}

export function openTrackSelectionModal(tracks = {}, { onAudio, onSubtitle } = {}) {
  const audio = Array.isArray(tracks.audio) ? tracks.audio : [];
  const subtitles = Array.isArray(tracks.subtitles) ? tracks.subtitles : [];
  const audioRows = audio.length
    ? audio.map((track, index) => `<button class="track-option${track.selected ? ' selected' : ''}" data-track-type="audio" data-track-id="${esc(track.id)}" ${track.selected || (!audio.some(value => value.selected) && index === 0) ? 'data-tv-autofocus' : ''}><strong>${track.selected ? '✓ ' : ''}${esc(track.label || `Áudio ${index + 1}`)}</strong>${track.language ? `<small>${esc(track.language)}</small>` : ''}</button>`).join('')
    : '<div class="empty-inline">Nenhuma faixa de áudio alternativa encontrada.</div>';
  const subtitleRows = [
    `<button class="track-option${subtitles.some(track => track.selected) ? '' : ' selected'}" data-track-type="subtitle" data-track-id="-1"><strong>${subtitles.some(track => track.selected) ? '' : '✓ '}Desligadas</strong></button>`,
    ...subtitles.map((track, index) => `<button class="track-option${track.selected ? ' selected' : ''}" data-track-type="subtitle" data-track-id="${esc(track.id)}"><strong>${track.selected ? '✓ ' : ''}${esc(track.label || `Legenda ${index + 1}`)}</strong>${track.language ? `<small>${esc(track.language)}</small>` : ''}</button>`)
  ].join('');

  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal track-selection-modal" role="dialog" aria-modal="true">
    <h2>Áudio e legendas</h2>
    <p>Escolha uma faixa disponível neste conteúdo.</p>
    <div class="track-columns">
      <section><h3>Áudio</h3><div class="track-list">${audioRows}</div></section>
      <section><h3>Legendas</h3><div class="track-list">${subtitleRows}</div></section>
    </div>
    <div class="form-actions"><button class="btn" data-close>Fechar</button></div>
  </div></div>`;

  qs('[data-close]', modalRoot).onclick = closeModal;
  qsa('[data-track-type]', modalRoot).forEach(button => {
    button.onclick = async () => {
      const type = button.dataset.trackType;
      const id = Number(button.dataset.trackId);
      try {
        if (type === 'audio') await onAudio?.(id);
        else await onSubtitle?.(id);
        closeModal();
      } catch (error) {
        toast(error?.message || 'Não foi possível trocar esta faixa.');
      }
    };
  });
}
