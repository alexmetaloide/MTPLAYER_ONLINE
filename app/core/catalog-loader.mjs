function cancelled() {
  const error = new Error('Carregamento de catálogo substituído ou cancelado.');
  error.name = 'AbortError';
  return error;
}

// Share IPC work within an account session, and publish only the newest result.
export function createCatalogLoader({ getAccountId, load, onCatalog }) {
  let generation = 0;
  const pending = new Map();
  const latest = new Map();

  function invalidate() {
    generation += 1;
    pending.clear();
    latest.clear();
  }

  function get(kind, { refresh = false } = {}) {
    const accountId = getAccountId();
    if (!accountId) return Promise.reject(new Error('Configure uma conta primeiro.'));
    const epoch = generation;
    const key = JSON.stringify([accountId, kind, Boolean(refresh)]);
    const refreshKey = JSON.stringify([accountId, kind, true]);
    const running = (!refresh && pending.get(refreshKey)) || pending.get(key);
    if (running) return running;

    const slot = JSON.stringify([accountId, kind]);
    const version = (latest.get(slot) || 0) + 1;
    latest.set(slot, version);
    const current = () => generation === epoch && getAccountId() === accountId
      && latest.get(slot) === version;
    const request = Promise.resolve().then(() => {
      if (!current()) throw cancelled();
      return load(kind, { refresh });
    }).then(catalog => {
      if (!current()) throw cancelled();
      onCatalog(kind, catalog, { refresh });
      return catalog;
    }).catch(error => {
      if (!current()) throw cancelled();
      throw error;
    }).finally(() => {
      // An obsolete request must not remove its replacement after invalidate().
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }

  return { get, invalidate };
}
