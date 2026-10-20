function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanXmlText(value) {
  const cdataExpanded = String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(cdataExpanded.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attrValue(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function parseXmltvTime(raw) {
  const match = String(raw || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s+([+-])(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00', sign, oh = '00', om = '00'] = match;
  let value = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (sign) {
    const offset = (Number(oh) * 60 + Number(om)) * 60 * 1000;
    value -= sign === '+' ? offset : -offset;
  }
  return Number.isFinite(value) ? value : null;
}

function firstTag(body, tag) {
  const match = String(body || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? cleanXmlText(match[1]) : '';
}

function parseXmltv(input, options = {}) {
  const now = Number(options.now) || Date.now();
  const pastMs = Number(options.pastMs) || 6 * 60 * 60 * 1000;
  const futureMs = Number(options.futureMs) || 30 * 60 * 60 * 1000;
  const maxPrograms = Math.min(Math.max(Number(options.maxPrograms) || 120000, 1000), 250000);
  const lowerBound = now - pastMs;
  const upperBound = now + futureMs;
  const byChannel = Object.create(null);
  const text = String(input || '');
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let count = 0;
  let match;
  while ((match = re.exec(text)) && count < maxPrograms) {
    const channel = attrValue(match[1], 'channel');
    const start = parseXmltvTime(attrValue(match[1], 'start'));
    const end = parseXmltvTime(attrValue(match[1], 'stop'));
    if (!channel || !start || !end || end < lowerBound || start > upperBound) continue;
    const row = {
      title: firstTag(match[2], 'title') || 'Programação',
      description: firstTag(match[2], 'desc'),
      start,
      end
    };
    (byChannel[channel] ||= []).push(row);
    count += 1;
  }
  for (const rows of Object.values(byChannel)) rows.sort((a, b) => a.start - b.start);
  return { byChannel, count, generatedAt: Date.now() };
}

function selectNowNext(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const currentIndex = list.findIndex(row => row.start <= now && row.end > now);
  const nowProgram = currentIndex >= 0 ? list[currentIndex] : null;
  const next = list.find(row => row.start > (nowProgram?.start ?? now)) || null;
  return { now: nowProgram, next };
}

async function decodeXmltvBuffer(buffer, maxOutputBytes = 60 * 1024 * 1024) {
  const source = new Uint8Array(buffer || []);
  const isGzip = source.length >= 2 && source[0] === 0x1f && source[1] === 0x8b;
  if (!isGzip) {
    if (source.byteLength > maxOutputBytes) throw new Error('XMLTV excede o limite permitido.');
    return new TextDecoder().decode(source);
  }
  if (!globalThis.DecompressionStream) throw new Error('Este navegador não descompacta XMLTV gzip. Use XML sem compressão.');
  const reader = new Blob([source]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxOutputBytes) throw new Error('XMLTV descompactado excede o limite permitido.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return new Blob(chunks).text();
}

export { parseXmltv, parseXmltvTime, selectNowNext, decodeXmltvBuffer, decodeEntities };
