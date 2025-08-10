// backend/services/strategies/utils/lruCache.js
module.exports = function createLRU(max = 200) {
  const m = new Map();
  return {
    get(k)  { return m.get(k); },
    set(k,v){ m.set(k, v); if (m.size > max) m.delete(m.keys().next().value);},
    has(k)  { return m.has(k); },
    clear() { m.clear(); },
  };
};