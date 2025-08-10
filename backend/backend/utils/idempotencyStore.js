const DEFAULT_TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS, 10) || 15 * 60 * 1000;

/**
 * A simple in-memory key→value store with a time-to-live. This helper is used
 * by the idempotency middleware and job runner to remember the result of
 * a previously executed operation for a short period of time. When the TTL
 * expires the cached entry is removed. Note: this implementation is
 * intentionally minimal and is not suitable for a multi-process cluster. For
 * production the same API could be backed by Redis or another shared store.
 */
class IdempotencyStore {
  /**
   * @param {number} ttlMs How long to retain entries (in milliseconds)
   */
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
    // Periodically clear expired entries. Using an unref()ed interval so it
    // doesn’t keep the Node process alive.
    this.cleanupInterval = setInterval(() => this.cleanup(), this.ttlMs);
    this.cleanupInterval.unref();
  }

  /**
   * Retrieve a previously cached value. Returns `undefined` when the key
   * doesn’t exist or has expired.
   * @param {string|null} key
   */
  get(key) {
    if (!key) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store a result for the given key. Overwrites any existing entry.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (!key) return;
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /** Remove a specific key from the store. */
  delete(key) {
    if (!key) return;
    this.cache.delete(key);
  }

  /** Remove any expired entries from the cache. */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

// Export a singleton instance for use across the application. A single
// instance avoids accidentally caching the same idempotency key in two
// separate stores.
const idempotencyStore = new IdempotencyStore();
module.exports = idempotencyStore;