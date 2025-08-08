// copied from backend/utils/cache.js
const store = new Map();
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  const { value, expiresAt } = entry;
  if (Date.now() > expiresAt) {
    store.delete(key);
    return null;
  }
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