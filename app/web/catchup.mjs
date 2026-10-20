function durationSeconds(start, end) {
  const value = Math.ceil((Math.max(0, Number(end) || 0) - Math.max(0, Number(start) || 0)) / 1000);
  return Math.max(60, value || 0);
}

function durationMinutes(start, end) {
  return Math.max(1, Math.ceil(durationSeconds(start, end) / 60));
}

function dateParts(value, timeZone = '') {
  const date = new Date(Number(value) || 0);
  const options = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  };
  if (timeZone) options.timeZone = timeZone;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { Y: map.year, m: map.month, d: map.day, H: map.hour, M: map.minute, S: map.second };
  } catch {
    return {
      Y: String(date.getFullYear()),
      m: String(date.getMonth() + 1).padStart(2, '0'),
      d: String(date.getDate()).padStart(2, '0'),
      H: String(date.getHours()).padStart(2, '0'),
      M: String(date.getMinutes()).padStart(2, '0'),
      S: String(date.getSeconds()).padStart(2, '0')
    };
  }
}

function formatXtreamStart(value, timeZone = '') {
  const p = dateParts(value, timeZone);
  return `${p.Y}-${p.m}-${p.d}:${p.H}-${p.M}`;
}

function replaceAllLiteral(value, token, replacement) {
  return value.split(token).join(String(replacement));
}

function buildM3uCatchupUrl(template, program = {}) {
  let url = String(template || '').trim();
  if (!url) throw new Error('Esta lista não informou uma URL de TV atrasada para o canal.');
  const startMs = Math.max(0, Number(program.start) || 0);
  const endMs = Math.max(startMs, Number(program.end) || startMs);
  if (!startMs || !endMs) throw new Error('A programação não possui horário válido para TV atrasada.');
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const duration = durationSeconds(startMs, endMs);
  const replacements = {
    '{utc}': start, '${utc}': start,
    '{start}': start, '${start}': start,
    '{timestamp}': start, '${timestamp}': start,
    '{utcend}': end, '${utcend}': end,
    '{end}': end, '${end}': end,
    '{duration}': duration, '${duration}': duration,
    '{offset}': 0, '${offset}': 0
  };
  for (const [token, replacement] of Object.entries(replacements)) url = replaceAllLiteral(url, token, replacement);
  const parts = dateParts(startMs);
  for (const [token, replacement] of Object.entries(parts)) url = replaceAllLiteral(url, `{${token}}`, replacement);
  return url;
}

export { durationSeconds, durationMinutes, dateParts, formatXtreamStart, buildM3uCatchupUrl };
