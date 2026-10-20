const FOCUS_SELECTOR = 'button:not([disabled]):not(.hidden), input:not([disabled]):not(.hidden), select:not([disabled]):not(.hidden), [tabindex]:not([tabindex="-1"]):not(.hidden)';
let cachedScope = null;
let cachedFocusables = null;
let cachedRects = null;
let lastRemoteFocus = null;
let initialFocusTimer = null;
let initialFocusRetryTimer = null;
let scheduledForceFocus = false;
let gridColumnCache = new WeakMap();
let pendingScrollFrame = null;
let lastDirectionalMoveAt = 0;

function invalidateNavigationCache() {
  cachedScope = null;
  cachedFocusables = null;
  cachedRects = null;
  gridColumnCache = new WeakMap();
}

function focusables(scope = document) {
  if (scope === cachedScope && cachedFocusables) return cachedFocusables;
  cachedScope = scope;
  cachedFocusables = [...scope.querySelectorAll(FOCUS_SELECTOR)]
    .filter(element => element.offsetParent !== null);
  cachedRects = null;
  return cachedFocusables;
}

function isTizenTv() {
  return document.documentElement.classList.contains('tizen-tv');
}

function isTvDevice() {
  return isTizenTv() || document.documentElement.classList.contains('android-tv');
}

function isTextInput(element) {
  return Boolean(element?.matches?.('input[type="text"],input[type="search"],input[type="password"],input:not([type])'));
}

const KEY_BY_CODE = {
  8: 'Backspace',
  13: 'Enter',
  27: 'Escape',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  65376: 'TvImeDone',
  65385: 'TvImeCancel',
  10009: 'XF86Back'
};

const KEY_ALIASES = {
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Select: 'Enter',
  OK: 'Enter',
  Return: 'Enter'
};

function normalizedKey(event) {
  // Alguns Web Runtimes Samsung entregam event.key como "Unidentified" e
  // expõem a tecla somente em keyCode/which. Use todos os sinais disponíveis.
  const numericCode = Number(event.keyCode || event.which || event.charCode || 0);
  const raw = KEY_BY_CODE[numericCode] || event.key || event.code || '';
  return KEY_ALIASES[raw] || raw;
}

function markRemoteFocus(element) {
  if (!isTvDevice()) return;
  if (lastRemoteFocus && lastRemoteFocus !== element) lastRemoteFocus.classList.remove('tv-nav-focus');
  element?.classList?.add('tv-nav-focus');
  lastRemoteFocus = element || null;
}

function finishTvInputEditing(element, { restoreFocus = true } = {}) {
  if (!isTizenTv() || !isTextInput(element)) return;
  element.readOnly = true;
  delete element.dataset.tvEditing;
  element.blur?.();

  if (restoreFocus) {
    setTimeout(() => {
      if (element.isConnected && element.offsetParent !== null) {
        element.focus({ preventScroll: true });
        markRemoteFocus(element);
      }
    }, 0);
  }
}

function prepareTvInput(element) {
  if (!isTizenTv() || !isTextInput(element)) return;
  if (element.dataset.tvInputPrepared === '1') return;
  element.dataset.tvInputPrepared = '1';
  element.readOnly = true;
  element.addEventListener('blur', () => {
    element.readOnly = true;
    delete element.dataset.tvEditing;
  });
}

function focusForNavigation(element) {
  if (!element) return null;
  prepareTvInput(element);
  try { element.focus({ preventScroll: true }); }
  catch { element.focus(); }
  markRemoteFocus(element);
  return element;
}

function beginTvInputEditing(element) {
  if (!isTizenTv() || !isTextInput(element)) return;
  element.blur?.();
  setTimeout(() => {
    if (!element.isConnected) return;
    // O blur encerra a edição anterior. Abra o teclado somente depois dele.
    element.readOnly = false;
    element.dataset.tvEditing = '1';
    try { element.focus({ preventScroll: true }); }
    catch { element.focus(); }
    element.click();
    try {
      const end = String(element.value || '').length;
      element.setSelectionRange?.(end, end);
    } catch {}
    markRemoteFocus(element);
  }, 0);
}

function activeScope() {
  const modalRoot = document.getElementById('modal-root');
  return modalRoot?.childElementCount ? modalRoot : document;
}

function isUsableFocus(element, scope) {
  return Boolean(
    element &&
    element !== document.body &&
    element !== document.documentElement &&
    scope.contains(element) &&
    element.offsetParent !== null
  );
}

function focusInitialControl({ force = false } = {}) {
  const scope = activeScope();
  const active = document.activeElement;
  if (!force && isUsableFocus(active, scope)) {
    markRemoteFocus(active);
    return active;
  }
  const preferred = scope.querySelector?.('[data-tv-autofocus]');
  const target = preferred && preferred.offsetParent !== null ? preferred : focusables(scope)[0];
  return focusForNavigation(target);
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function nextByDirection(current, direction, scope = document) {
  const all = focusables(scope);
  if (!cachedRects) {
    cachedRects = new Map();
    for (const element of all) cachedRects.set(element, element.getBoundingClientRect());
  }
  const fromRect = cachedRects.get(current) || current.getBoundingClientRect();
  const from = center(fromRect);
  const horizontal = direction === 'ArrowRight' || direction === 'ArrowLeft';
  let best = null;
  let bestScore = Infinity;
  let bestAligned = false;
  for (const element of all) {
    if (element === current) continue;
    const toRect = cachedRects.get(element) || element.getBoundingClientRect();
    const to = center(toRect);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (direction === 'ArrowRight' && dx <= 5) continue;
    if (direction === 'ArrowLeft' && dx >= -5) continue;
    if (direction === 'ArrowDown' && dy <= 5) continue;
    if (direction === 'ArrowUp' && dy >= -5) continue;
    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    // Priorize a mesma linha/coluna. Campos largos não devem atrair o foco
    // para cima ao apertar Direita nem fazer Baixo pular um campo próximo.
    const aligned = horizontal
      ? Math.min(fromRect.bottom, toRect.bottom) > Math.max(fromRect.top, toRect.top)
      : Math.min(fromRect.right, toRect.right) > Math.max(fromRect.left, toRect.left);
    const score = primary + secondary * (aligned ? .01 : 2.2);
    if (!best || (aligned && !bestAligned) || (aligned === bestAligned && score < bestScore)) {
      best = element;
      bestScore = score;
      bestAligned = aligned;
    }
  }
  return best;
}

function gridColumns(grid) {
  if (!grid) return 1;
  const cached = gridColumnCache.get(grid);
  if (cached) return cached;
  const template = getComputedStyle(grid).gridTemplateColumns || '';
  const columns = Math.max(1, template.trim().split(/\s+/).filter(Boolean).length);
  gridColumnCache.set(grid, columns);
  return columns;
}

function fastCatalogTarget(current, direction) {
  const grid = current?.closest?.('#item-grid');
  if (grid && current.classList.contains('item-card')) {
    const cards = grid.children;
    const index = Number(current.dataset.pageIndex);
    const columns = gridColumns(grid);
    if (!Number.isInteger(index) || index < 0) return null;
    if (direction === 'ArrowLeft') {
      if (index % columns > 0) return cards[index - 1] || current;
      return document.querySelector('#category-list .active') || document.querySelector('#category-list button') || current;
    }
    if (direction === 'ArrowRight') {
      if (index % columns < columns - 1 && cards[index + 1]) return cards[index + 1];
      return current;
    }
    if (direction === 'ArrowUp') return cards[index - columns] || current;
    if (direction === 'ArrowDown') {
      if (cards[index + columns]) return cards[index + columns];
      const more = document.getElementById('load-more');
      return more && !more.classList.contains('hidden') ? more : current;
    }
  }

  if (current?.matches?.('#category-list button')) {
    if (direction === 'ArrowUp') return current.previousElementSibling || document.getElementById('search-input') || current;
    if (direction === 'ArrowDown') return current.nextElementSibling || current;
    if (direction === 'ArrowRight') return document.querySelector('#item-grid .item-card') || current;
    if (direction === 'ArrowLeft') return document.querySelector('.sidebar-head button') || current;
  }

  if (current?.id === 'search-input') {
    if (direction === 'ArrowDown') return document.querySelector('#category-list button') || current;
    if (direction === 'ArrowRight') return document.querySelector('#item-grid .item-card') || current;
    if (direction === 'ArrowUp') return document.querySelector('.sidebar-head button') || current;
  }

  if (current?.matches?.('.sidebar-head button')) {
    if (direction === 'ArrowDown') return document.getElementById('search-input') || current;
    if (direction === 'ArrowRight') return document.querySelector('#item-grid .item-card') || current;
  }

  if (current?.id === 'load-more' && direction === 'ArrowUp') {
    const cards = document.querySelectorAll('#item-grid .item-card');
    return cards[cards.length - 1] || current;
  }

  return null;
}

function fastGridTarget(current, direction) {
  const grid = current?.parentElement;
  if (!grid?.matches?.('.primary-grid,.shortcut-grid,.settings-grid,.continue-grid,.profile-grid,.pin-keypad')) return null;
  const children = [...grid.children].filter(element => element.matches?.('button'));
  const index = children.indexOf(current);
  if (index < 0) return null;
  const columns = gridColumns(grid);
  if (direction === 'ArrowLeft' && index % columns > 0) return children[index - 1] || null;
  if (direction === 'ArrowRight' && index % columns < columns - 1) return children[index + 1] || null;
  if (direction === 'ArrowUp') return children[index - columns] || null;
  if (direction === 'ArrowDown') return children[index + columns] || null;
  return null;
}

function scrollForNavigation(target, direction) {
  if (!target || (direction !== 'ArrowUp' && direction !== 'ArrowDown')) return;
  if (pendingScrollFrame) cancelAnimationFrame(pendingScrollFrame);
  pendingScrollFrame = requestAnimationFrame(() => {
    pendingScrollFrame = null;
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  });
}

function ensureTvWindowFocus() {
  if (!isTvDevice()) return;
  try { window.focus(); } catch {}
}

function scheduleInitialFocus({ force = false } = {}) {
  ensureTvWindowFocus();
  scheduledForceFocus = scheduledForceFocus || force;
  if (initialFocusTimer) return;
  initialFocusTimer = setTimeout(() => {
    initialFocusTimer = null;
    invalidateNavigationCache();
    const target = focusInitialControl({ force: scheduledForceFocus });
    scheduledForceFocus = false;
    if (target || initialFocusRetryTimer) return;
    initialFocusRetryTimer = setTimeout(() => {
      initialFocusRetryTimer = null;
      invalidateNavigationCache();
      focusInitialControl();
    }, 120);
  }, 0);
}

export function initRemoteNavigation({ onBack }) {
  document.addEventListener('focusin', event => {
    if (event.target?.matches?.('button,input,select,[tabindex]')) markRemoteFocus(event.target);
  });

  const handleKeyDown = event => {
    const key = normalizedKey(event);
    const scope = activeScope();
    let active = document.activeElement;
    const activeIsTextInput = isTextInput(active);
    const editingTvInput = isTizenTv() && activeIsTextInput && active?.dataset?.tvEditing === '1';
    const isImeDone = event.keyCode === 65376 || event.which === 65376 || key === 'TvImeDone';
    const isImeCancel = event.keyCode === 65385 || event.which === 65385 || key === 'TvImeCancel';
    const numericCode = Number(event.keyCode || event.which || 0);
    const isTizenBack = numericCode === 10009 || key === 'XF86Back' || key === 'BrowserBack';

    if (editingTvInput && (isImeDone || isImeCancel)) {
      event.preventDefault();
      event.stopPropagation();
      finishTvInputEditing(active);
      return;
    }

    if (editingTvInput && isTizenBack) {
      event.preventDefault();
      event.stopPropagation();
      finishTvInputEditing(active);
      return;
    }

    if (key === 'Escape' || isTizenBack || (key === 'Backspace' && !activeIsTextInput)) {
      event.preventDefault();
      event.stopPropagation();
      onBack?.();
      invalidateNavigationCache();
      scheduleInitialFocus({ force: true });
      return;
    }

    if (key === 'Enter') {
      if (editingTvInput) return;
      if (!isUsableFocus(active, scope)) active = focusInitialControl({ force: true });
      if (isTizenTv() && isTextInput(active)) {
        event.preventDefault();
        event.stopPropagation();
        beginTvInputEditing(active);
        return;
      }
      if (active?.tagName === 'BUTTON') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          active.click();
          invalidateNavigationCache();
        }
      }
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    // Desktop media sliders need native range-key behavior, not spatial focus navigation.
    if (!isTvDevice() && scope === document && active?.matches?.('input[type="range"]') && active.closest('.cinema-player')) return;
    if (editingTvInput) return;
    if (activeIsTextInput && ['ArrowLeft', 'ArrowRight'].includes(key) && !isTizenTv()) return;

    event.preventDefault();
    event.stopPropagation();
    if (isTvDevice()) {
      const now = Date.now();
      if (event.repeat && now - lastDirectionalMoveAt < 55) return;
      lastDirectionalMoveAt = now;
    }
    if (!isUsableFocus(active, scope)) active = focusInitialControl({ force: true });
    if (!active) return;

    const next = isTvDevice()
      ? (fastCatalogTarget(active, key) || fastGridTarget(active, key) || nextByDirection(active, key, scope))
      : nextByDirection(active, key, scope);
    const target = next || active;
    focusForNavigation(target);
    if (isTvDevice()) scrollForNavigation(target, key);
    else target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  // Capture no window recebe as setas mesmo quando um controle interno do
  // Web Runtime Samsung tenta consumir o evento antes de chegar ao document.
  window.addEventListener('keydown', handleKeyDown, true);

  if (isTvDevice()) {
    const observer = new MutationObserver(() => {
      invalidateNavigationCache();
      scheduleInitialFocus();
    });
    const viewRoot = document.getElementById('view-root');
    const modalRoot = document.getElementById('modal-root');
    if (viewRoot) observer.observe(viewRoot, { childList: true, subtree: true });
    if (modalRoot) observer.observe(modalRoot, { childList: true, subtree: true });
    window.addEventListener('focus', scheduleInitialFocus);
    window.addEventListener('pageshow', scheduleInitialFocus);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleInitialFocus();
    });
  }

  scheduleInitialFocus();
}
