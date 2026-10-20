/** Fisher-Yates shuffle, avoiding a repeated title at the boundary between cycles. */
export function shuffleFeed(items, { random = Math.random, avoidFirstKey = '', avoidLastKey = '' } = {}) {
  const shuffled = [...(items || [])];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const sample = Number(random());
    const j = Math.min(i, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * (i + 1))));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (shuffled.length > 1) {
    const key = item => `${item.kind}:${item.id}`;
    if (key(shuffled[0]) === avoidFirstKey) {
      const swap = 1 + Math.min(shuffled.length - 2, Math.floor(random() * (shuffled.length - 1)));
      [shuffled[0], shuffled[swap]] = [shuffled[swap], shuffled[0]];
    }
    if (key(shuffled[shuffled.length - 1]) === avoidLastKey) {
      const swap = Math.min(shuffled.length - 2, Math.floor(random() * (shuffled.length - 1)));
      [shuffled[shuffled.length - 1], shuffled[swap]] = [shuffled[swap], shuffled[shuffled.length - 1]];
    }
  }
  return shuffled;
}
