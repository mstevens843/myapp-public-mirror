// utils/priceCache.js
// --------------------------------------------------------------------
// Shared, 30-second in-memory cache for token prices
// Uses marketData helpers under the hood, but guarantees
// – max-one fetch per token per 30 s
// – easy future throttling / fallback
// --------------------------------------------------------------------
const { getTokenPrice, getTokenPriceApp } = require("./marketData");

const TTL   = 30_000;                 // 30-second freshness window
const cache = new Map();              // mint ⇒ { price, ts }

/**
 * getCachedPrice(mint [, { app, force }])
 *
 * • app   – use getTokenPriceApp() variant (frontend-friendly logic)
 * • force – ignore cache (rarely needed)
 */
async function getCachedPrice(mint, { app = false, force = false } = {}) {
  const entry = cache.get(mint);
  const now   = Date.now();

  if (!force && entry && now - entry.ts < TTL) return entry.price;

  const price = app
    ? await getTokenPriceApp(mint)
    : await getTokenPrice(mint);

  cache.set(mint, { price, ts: now });
  return price;
}

module.exports = { getCachedPrice };
