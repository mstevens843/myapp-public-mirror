const assert = require('assert');
const { shouldDirectAmmFallback } = require('../../utils/ammFallbackGuard');

/**
 * Tests for the AMM fallback guard.  This helper decides when to
 * fallback to a direct AMM swap based on quote age, pool freshness
 * and volatility.  These tests verify the basic logic.
 */
function run() {
  // latency exceeds threshold and pool is fresh → true
  let result = shouldDirectAmmFallback({
    quoteAgeMs: 300,
    fallbackQuoteLatencyMs: 250,
    poolFresh: true,
    volatilityPct: 1,
    maxVolatilityPct: 5,
  });
  assert.strictEqual(result, true, 'should fallback when latency high and pool fresh');

  // latency below threshold → false
  result = shouldDirectAmmFallback({
    quoteAgeMs: 100,
    fallbackQuoteLatencyMs: 250,
    poolFresh: true,
    volatilityPct: 1,
    maxVolatilityPct: 5,
  });
  assert.strictEqual(result, false, 'should not fallback when latency low');

  // pool not fresh → false
  result = shouldDirectAmmFallback({
    quoteAgeMs: 400,
    fallbackQuoteLatencyMs: 250,
    poolFresh: false,
    volatilityPct: 1,
    maxVolatilityPct: 5,
  });
  assert.strictEqual(result, false, 'should not fallback when pool not fresh');

  console.log('ammFallbackGuard tests passed');
}

if (require.main === module) {
  run();
}

module.exports = run;