// Simple in-memory cache with TTL and Prometheus instrumentation.  The
// cache stores values keyed by arbitrary strings and expires entries
// after the configured TTL.  When retrieving keys the caller can
// prefix the key with a namespace (e.g. "price:SOL") to allow
// metrics to be aggregated per namespace.  Cache hits and misses are
// counted and the hit ratio gauge is updated on each access.

const store = new Map();
const metrics = require('./metrics');

function getNamespace(key) {
  if (!key) return 'default';
  const str = String(key);
  const idx = str.indexOf(':');
  return idx === -1 ? str : str.slice(0, idx);
}

function get(key) {
  const namespace = getNamespace(key);
  const entry = store.get(key);
  if (!entry) {
    metrics.recordCacheMiss(namespace);
    return null;
  }
  const { value, expiresAt } = entry;
  if (Date.now() > expiresAt) {
    store.delete(key);
    metrics.recordCacheMiss(namespace);
    return null;
  }
  metrics.recordCacheHit(namespace);
  return value;
}

function set(key, value, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  store.set(key, { value, expiresAt });
}

async function withCache(key, ttlMs, fn) {
  const cached = get(key);
  if (cached != null) return cached;
  const result = await fn();
  if (result !== undefined) {
    set(key, result, ttlMs);
  }
  return result;
}

module.exports = { get, set, withCache };