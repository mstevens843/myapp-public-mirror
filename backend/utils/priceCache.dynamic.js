// utils/priceCache.dynamic.js
// ─────────────────────────────────────────────────────────────
// Bot polling price cache (for SL/TP/DCA/Limit monitors)
// • 60-second TTL
// • Pulls from getTokenPrice()
// ─────────────────────────────────────────────────────────────
const { getTokenPrice } = require("./marketData");

const TTL   = 60_000;  // 1 minute
const cache = new Map();

async function getCachedPrice(mint, { force = false } = {}) {
  const entry = cache.get(mint);
  const now   = Date.now();

  if (!force && entry && now - entry.ts < TTL) return entry.price;

  const price = await getTokenPrice(req.user.id, mint);
  cache.set(mint, { price, ts: now });
  return price;
}

module.exports = { getCachedPrice };
