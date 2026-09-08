const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60;

// apiKey → array of request timestamps (within the current window)
const store = new Map<string, number[]>();

/**
 * Simple in-memory rate limiter. Returns true if the request is allowed,
 * false if the rate limit has been exceeded.
 */
export function checkRateLimit(apiKey: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = store.get(apiKey);
  if (!timestamps) {
    timestamps = [];
    store.set(apiKey, timestamps);
  }

  // Evict expired entries
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_REQUESTS) return false;

  timestamps.push(now);
  return true;
}
