'use strict';

/**
 * Decide whether to bypass the router and go direct to an AMM.
 *
 * Contract (new):
 *   Go direct iff:
 *     1) quoteAgeMs > quoteLatencyThresholdMs
 *     2) pool is fresh: (poolAgeMs <= poolFreshnessTtlMs)  [OR legacy: poolFresh === true]
 *     3) expectedSlipPct <= expectedSlipBoundPct (when a bound is provided)
 *   Optional clamp:
 *     4) volatilityPct <= maxVolatilityPct (when provided)
 *
 * Backward compatibility:
 *   - Accepts legacy names { fallbackQuoteLatencyMs, poolFresh }.
 *   - If poolAgeMs/freshnessTtlMs are not provided, falls back to poolFresh boolean.
 *
 * @param {Object} params
 * @param {number} params.quoteAgeMs                // required to evaluate condition (1)
 * @param {number} [params.quoteLatencyThresholdMs] // preferred threshold name
 * @param {number} [params.fallbackQuoteLatencyMs]  // legacy threshold name
 * @param {number} [params.poolAgeMs]               // ms since pool state was refreshed (preferred)
 * @param {number} [params.poolFreshnessTtlMs]      // how old pool data can be and still be considered "fresh"
 * @param {boolean} [params.poolFresh]              // legacy freshness boolean
 * @param {number} [params.expectedSlipPct]         // predicted/expected slippage in %
 * @param {number} [params.expectedSlipBoundPct]    // max allowed expected slip for direct fallback in %
 * @param {number} [params.volatilityPct]           // optional observed volatility %
 * @param {number} [params.maxVolatilityPct]        // optional volatility cap %
 * @returns {boolean}
 */
function shouldDirectAmmFallback(params = {}) {
  const {
    quoteAgeMs,
    quoteLatencyThresholdMs,
    fallbackQuoteLatencyMs, // legacy
    poolAgeMs,
    poolFreshnessTtlMs,
    poolFresh,              // legacy
    expectedSlipPct,
    expectedSlipBoundPct,
    volatilityPct,
    maxVolatilityPct,
  } = params;

  // 1) Quote latency gate
  const threshold =
    Number.isFinite(quoteLatencyThresholdMs)
      ? Number(quoteLatencyThresholdMs)
      : Number(fallbackQuoteLatencyMs);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;

  const age = Number(quoteAgeMs);
  if (!Number.isFinite(age) || age <= threshold) return false;

  // 2) Pool freshness gate
  let isFresh = false;
  if (Number.isFinite(poolAgeMs) && Number.isFinite(poolFreshnessTtlMs)) {
    isFresh = poolAgeMs <= poolFreshnessTtlMs;
  } else if (typeof poolFresh === 'boolean') {
    // legacy boolean path
    isFresh = poolFresh;
  }
  if (!isFresh) return false;

  // 3) Expected slippage bound gate (only enforced if a bound is provided)
  if (Number.isFinite(expectedSlipBoundPct)) {
    if (!Number.isFinite(expectedSlipPct)) return false;
    if (expectedSlipPct > expectedSlipBoundPct) return false;
  }

  // 4) Optional volatility clamp (kept for back-compat with your previous guard)
  if (Number.isFinite(maxVolatilityPct) && Number.isFinite(volatilityPct)) {
    if (volatilityPct > maxVolatilityPct) return false;
  }

  return true;
}

/**
 * Helper for testing/telemetry: returns the decision and the first failing reason.
 * Never used on the hot path; keep it out of production builds if you want.
 */
function explainDirectAmmDecision(params = {}) {
  const {
    quoteAgeMs,
    quoteLatencyThresholdMs,
    fallbackQuoteLatencyMs,
    poolAgeMs,
    poolFreshnessTtlMs,
    poolFresh,
    expectedSlipPct,
    expectedSlipBoundPct,
    volatilityPct,
    maxVolatilityPct,
  } = params;

  const threshold =
    Number.isFinite(quoteLatencyThresholdMs)
      ? Number(quoteLatencyThresholdMs)
      : Number(fallbackQuoteLatencyMs);

  if (!Number.isFinite(threshold) || threshold <= 0)
    return { ok: false, reason: 'no_threshold' };

  const age = Number(quoteAgeMs);
  if (!Number.isFinite(age)) return { ok: false, reason: 'no_quote_age' };
  if (age <= threshold) return { ok: false, reason: 'latency_below_threshold' };

  let isFresh = false;
  if (Number.isFinite(poolAgeMs) && Number.isFinite(poolFreshnessTtlMs)) {
    isFresh = poolAgeMs <= poolFreshnessTtlMs;
  } else if (typeof poolFresh === 'boolean') {
    isFresh = poolFresh;
  }
  if (!isFresh) return { ok: false, reason: 'pool_not_fresh' };

  if (Number.isFinite(expectedSlipBoundPct)) {
    if (!Number.isFinite(expectedSlipPct))
      return { ok: false, reason: 'no_expected_slip' };
    if (expectedSlipPct > expectedSlipBoundPct)
      return { ok: false, reason: 'expected_slip_above_bound' };
  }

  if (Number.isFinite(maxVolatilityPct) && Number.isFinite(volatilityPct)) {
    if (volatilityPct > maxVolatilityPct)
      return { ok: false, reason: 'volatility_above_max' };
  }

  return { ok: true, reason: 'passed' };
}

module.exports = { shouldDirectAmmFallback, explainDirectAmmDecision };
