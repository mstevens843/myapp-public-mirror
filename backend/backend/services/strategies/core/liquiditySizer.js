// backend/services/strategies/core/liquiditySizer.js
//
// LiquiditySizer applies a number of pre‑trade caps based on pool reserves,
// price impact and minimum USD thresholds. The sizing logic uses the provided
// priceImpactEstimator to approximate the effect of different trade sizes and
// reduces the requested amount accordingly. Metrics emitted include:
//   - sizing_reduced_pct: a gauge representing the percent reduction applied
//   - price_impact_pct: a histogram of the estimated price impact for the final amount
//
// Usage:
// const finalAmount = await sizeTrade({ amount, poolReserves, priceImpactEstimator, config, metrics });

async function sizeTrade({ amount, poolReserves, priceImpactEstimator, config = {}, metrics }) {
  let finalAmount = amount;
  const {
    maxImpactPct = 1.2,
    maxPoolPct = 0.8,
    minUsd = 50,
  } = config;

  // Cap by pool reserves percentage if provided
  if (poolReserves != null && !Number.isNaN(poolReserves)) {
    const maxByPool = poolReserves * maxPoolPct;
    if (Number.isFinite(maxByPool)) {
      finalAmount = Math.min(finalAmount, maxByPool);
    }
  }

  // Cap by price impact using provided estimator
  if (priceImpactEstimator && typeof priceImpactEstimator === 'function') {
    try {
      const impact = await priceImpactEstimator(amount);
      if (impact > maxImpactPct && impact > 0) {
        const reductionFactor = maxImpactPct / impact;
        const candidate = amount * reductionFactor;
        if (Number.isFinite(candidate) && candidate > 0) {
          finalAmount = Math.min(finalAmount, candidate);
        }
      }
    } catch (err) {
      // If estimator fails don't modify finalAmount
    }
  }

  // Ensure the amount is at least the minimum USD threshold
  if (finalAmount < minUsd) {
    finalAmount = minUsd;
  }

  // Emit metrics about the reduction and the predicted impact for the final size
  if (metrics) {
    const reductionPct = amount > 0 ? ((amount - finalAmount) / amount) * 100 : 0;
    if (typeof metrics.observe === 'function') {
      metrics.observe('sizing_reduced_pct', reductionPct);
      if (priceImpactEstimator && typeof priceImpactEstimator === 'function') {
        priceImpactEstimator(finalAmount)
          .then((finalImpact) => {
            metrics.observe('price_impact_pct', finalImpact);
          })
          .catch(() => {});
      }
    }
  }

  return finalAmount;
}

module.exports = { sizeTrade };
