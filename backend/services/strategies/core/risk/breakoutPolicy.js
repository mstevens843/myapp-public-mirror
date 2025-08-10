/**
 * Breakout risk policy.
 *
 * Contains helper functions to enforce risk controls specific to the
 * Breakout strategy.  These policies supplement the global trade
 * guards and provide strategy‑specific constraints such as maximum
 * allowed price impact, cool‑downs after fakeouts, and blacklists for
 * recently rug‑pulled tokens.
 */

/* eslint-disable no-console */

const rugBlacklist = new Set();
const fakeoutTimestamps = new Map();

/**
 * Check whether the current token is blacklisted due to a recent rug or
 * other catastrophic event.  Callers should pass the mint address.
 *
 * @param {string} mint
 * @returns {boolean}
 */
function isBlacklisted(mint) {
  return rugBlacklist.has(mint);
}

/**
 * Add a token to the rug blacklist.  This is typically called when a
 * strategy detects a honeypot or severe slippage.  Blacklist entries
 * expire automatically after a TTL (default 6 hours).
 *
 * @param {string} mint
 * @param {number} ttlMs
 */
function addToBlacklist(mint, ttlMs = 6 * 60 * 60 * 1000) {
  rugBlacklist.add(mint);
  setTimeout(() => rugBlacklist.delete(mint), ttlMs).unref();
}

/**
 * Determine whether a trade should be throttled due to a recent fakeout.
 * A fakeout is defined as a breakout entry that immediately reverts and
 * hits stop loss or fails to hit target profit.  When this occurs the
 * function records the timestamp and prevents further trades for a
 * configurable cool‑down period.
 *
 * @param {string} mint
 * @param {number} cooldownMs
 * @returns {boolean} true if still in cool‑down
 */
function inFakeoutCooldown(mint, cooldownMs = 30 * 60 * 1000) {
  const lastTime = fakeoutTimestamps.get(mint);
  if (!lastTime) return false;
  return Date.now() - lastTime < cooldownMs;
}

/**
 * Record that a fakeout occurred for the given mint.  This should be
 * invoked by the strategy whenever a trade is exited early due to
 * hitting stop loss or failure to follow through.  The timestamp is
 * stored for later cool‑down checks.
 *
 * @param {string} mint
 */
function recordFakeout(mint) {
  fakeoutTimestamps.set(mint, Date.now());
}

/**
 * Compute the maximum allowable buy amount based on a desired price
 * impact percentage and the current liquidity.  Callers must supply
 * current liquidity (e.g., pool reserves) and desired maximum price
 * impact.  The function returns the maximum notional the strategy
 * should purchase to stay under the price impact.
 *
 * This helper does not fetch on‑chain data; it merely performs
 * arithmetic.  Integrators should prefetch liquidity metrics.
 *
 * @param {number} liquidityUsd  Total liquidity in USD
 * @param {number} maxImpact     Desired maximum price impact as decimal (e.g., 0.05 = 5%)
 * @returns {number} suggested maximum buy size in USD
 */
function maxBuyForImpact(liquidityUsd, maxImpact = 0.05) {
  if (!liquidityUsd || liquidityUsd <= 0 || maxImpact <= 0) return 0;
  return liquidityUsd * maxImpact;
}

module.exports = {
  isBlacklisted,
  addToBlacklist,
  inFakeoutCooldown,
  recordFakeout,
  maxBuyForImpact,
};