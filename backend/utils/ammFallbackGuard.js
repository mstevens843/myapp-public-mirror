/**
 * Determine whether to fallback directly to an AMM swap instead of
 * using the router.  The decision is based on the age of the quote
 * (latency), pool freshness and observed volatility.  Fallback is
 * only triggered when `quoteAgeMs` exceeds `fallbackQuoteLatencyMs`,
 * `poolFresh` is true and either no volatility limit is specified or
 * `volatilityPct` is less than or equal to `maxVolatilityPct`.
 *
 * @param {Object} params
 * @param {number} params.quoteAgeMs Age of the quote in milliseconds
 * @param {number} params.fallbackQuoteLatencyMs Threshold to trigger fallback
 * @param {boolean} params.poolFresh Whether the liquidity pools are considered fresh
 * @param {number} [params.volatilityPct] Observed volatility percentage
 * @param {number} [params.maxVolatilityPct] Maximum allowable volatility for fallback
 * @returns {boolean} True if the executor should route directly to the AMM
 */
function shouldDirectAmmFallback({
  quoteAgeMs,
  fallbackQuoteLatencyMs,
  poolFresh,
  volatilityPct,
  maxVolatilityPct,
}) {
  // If no fallback is configured or no threshold provided, never fallback
  if (!fallbackQuoteLatencyMs || typeof fallbackQuoteLatencyMs !== 'number') return false;
  if (typeof quoteAgeMs !== 'number') return false;
  if (!poolFresh) return false;
  if (quoteAgeMs <= fallbackQuoteLatencyMs) return false;
  if (typeof maxVolatilityPct === 'number' && typeof volatilityPct === 'number') {
    if (volatilityPct > maxVolatilityPct) return false;
  }
  return true;
}

module.exports = { shouldDirectAmmFallback };