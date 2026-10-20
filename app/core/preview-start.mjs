/** One bounded seek past the opening, with enough room left for the short clip. */
export function choosePreviewStart(duration, { clipSeconds = 12, random = Math.random } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const reserve = Math.min(clipSeconds, duration * .4);
  const lastStart = Math.max(0, duration - reserve - Math.min(1, duration * .05));
  const minimum = Math.min(lastStart, duration > 180 ? Math.max(90, duration * .1) : duration * .2);
  const maximum = Math.min(lastStart, duration > 180 ? duration * .85 : duration * .65);
  const sample = Number(random());
  return minimum + Math.max(0, maximum - minimum) * Math.max(0, Math.min(1, Number.isFinite(sample) ? sample : .5));
}
