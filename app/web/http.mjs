export function normalizeHttpUrl(value, pageProtocol = globalThis.location?.protocol) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Informe uma URL HTTP/HTTPS completa.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use HTTP/HTTPS, sem usuário ou senha no domínio da URL.');
  }
  if (pageProtocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('Este webapp usa HTTPS. Peça ao provedor um endereço HTTPS; HTTP é bloqueado pelo navegador.');
  }
  return url.href;
}

export function createHttp(fetcher = globalThis.fetch.bind(globalThis)) {
  async function getBuffer(value, { maxBytes = 50 * 1024 * 1024, timeoutMs = 45000, accept = '*/*' } = {}) {
    const url = normalizeHttpUrl(value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    try {
      const response = await fetcher(url, {
        mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        cache: 'no-store', signal: controller.signal, headers: { Accept: accept }
      });
      if (!response.ok) throw new Error(`O servidor respondeu HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('A resposta excede o limite de tamanho.');
      reader = response.body?.getReader();
      if (!reader) throw new Error('Este navegador não oferece leitura de resposta em fluxo.');
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('A resposta excede o limite de tamanho.');
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('O servidor demorou demais para responder.');
      if (error instanceof TypeError) throw new Error('Conexão bloqueada ou indisponível. Verifique HTTPS, certificado e CORS no provedor. O GitHub Pages não contorna CORS.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
  }
  const getText = async (url, options) => new TextDecoder().decode(await getBuffer(url, options));
  const getJson = async (url, options) => {
    const text = await getText(url, options);
    try { return JSON.parse(text); }
    catch { throw new Error('O servidor não retornou JSON válido. Confira o endereço da API.'); }
  };
  return { getBuffer, getText, getJson, normalizeHttpUrl };
}
