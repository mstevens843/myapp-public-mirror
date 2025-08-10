/**
 * Breakout signal generator.
 *
 * This helper inspects simple arrays of price, liquidity and volume
 * information and emits high‑level breakout cues.  It is deliberately
 * synchronous and lightweight so it can be invoked from the hot path
 * without blocking.  Real implementations might source these inputs
 * from a cached feed or in‑memory store.
 *
 * Expected keys on the `state` object:
 *  - prices: Array<number> of recent trade prices (ascending in time)
 *  - lp:     Array<number> of recent liquidity pool depths or reserves
 *  - volume: Array<number> of recent traded volume figures
 *
 * The returned array contains objects with a `type` property.  The
 * supported types are:
 *  - "squeeze"     → volatility contraction (stddev drop)
 *  - "liquidityPull" → sudden drop in liquidity depth
 *  - "expansion"    → price breakout accompanied by volume surge
 *
 * @param {Object} state input data; all properties optional
 * @returns {Array<Object>} list of detected signals
 */
module.exports = function breakoutSignals(state = {}) {
  const signals = [];
  const prices = Array.isArray(state.prices) ? state.prices : [];
  const lp     = Array.isArray(state.lp)     ? state.lp     : [];
  const volume = Array.isArray(state.volume) ? state.volume : [];

  // Volatility squeeze: compare the standard deviation of the last
  // 10 price points against the prior 10 points.  A significant drop
  // (70% or more) suggests a compression in volatility.
  if (prices.length >= 20) {
    const last10 = prices.slice(-10);
    const prev10 = prices.slice(-20, -10);
    const stdev = (arr) => {
      const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
      const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
      return Math.sqrt(variance);
    };
    const stdLast = stdev(last10);
    const stdPrev = stdev(prev10);
    if (stdPrev > 0 && stdLast < 0.7 * stdPrev) {
      signals.push({ type: "squeeze" });
    }
  }

  // Liquidity pull: the mean liquidity depth over the most recent
  // 5 samples is significantly lower than the mean of the previous
  // 5 samples.  This can signal an impending move as liquidity is
  // withdrawn.
  if (lp.length >= 10) {
    const last5 = lp.slice(-5);
    const prev5 = lp.slice(-10, -5);
    const mean = (arr) => arr.reduce((acc, val) => acc + val, 0) / arr.length;
    const meanLast = mean(last5);
    const meanPrev = mean(prev5);
    if (meanPrev > 0 && meanLast < 0.85 * meanPrev) {
      signals.push({ type: "liquidityPull" });
    }
  }

  // Expansion: price appreciation of at least 3% over the last five
  // ticks accompanied by a surge in recent volume relative to the
  // 10‑period baseline.  A breakout without volume is often a trap;
  // this condition guards against that scenario.
  if (prices.length >= 6 && volume.length >= 10) {
    const priceNow = prices[prices.length - 1];
    const pricePrev = prices[prices.length - 6];
    if (pricePrev > 0 && (priceNow - pricePrev) / pricePrev >= 0.03) {
      const mean = (arr) => arr.reduce((acc, val) => acc + val, 0) / arr.length;
      const volLast3 = mean(volume.slice(-3));
      const volLast10 = mean(volume.slice(-10));
      if (volLast10 > 0 && volLast3 > 1.8 * volLast10) {
        signals.push({ type: "expansion" });
      }
    }
  }
  return signals;
};