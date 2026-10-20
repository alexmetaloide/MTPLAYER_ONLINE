/** Counts completed episodes between deliberate user interactions. */
export function createInactivityGuard(threshold = 3) {
  let completed = 0;
  let lastToken = null;
  return {
    interact() { completed = 0; },
    finish(token) {
      if (token !== lastToken) { lastToken = token; completed += 1; }
    },
    shouldAsk() { return completed >= threshold; },
    get count() { return completed; }
  };
}
