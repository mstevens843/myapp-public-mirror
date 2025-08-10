// utils/priceCache.static.js
// ─────────────────────────────────────────────────────────────
// UI-driven price cache (for pages like Wallet / OpenTrades)
// • 5-min TTL (since user refreshes are rare)
// • Pulls from getTokenPriceApp()
// ─────────────────────────────────────────────────────────────
const { getTokenPriceApp } = require("./marketData");

const TTL   = 15_000;  // 15 seconds
const cache = new Map();

async function getCachedPrice(mint) {
  const entry = cache.get(mint);
  const now   = Date.now();

  if (entry && now - entry.ts < TTL) return entry.price;

  const price = await getTokenPriceApp(mint);
  cache.set(mint, { price, ts: now });
  return price;
}

module.exports = { getCachedPrice };
