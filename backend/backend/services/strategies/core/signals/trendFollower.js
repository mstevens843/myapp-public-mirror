/**
 * Trend follower signal helpers.
 *
 * Provides multiâ€‘timeframe moving average crossovers and trailing stop
 * calculations used by the Trend Follower strategy.  The helpers
 * compute exponential moving averages (EMAs) over arbitrary windows
 * and expose functions to determine trend alignment across short,
 * medium and long timeframes.  A stopâ€‘andâ€‘reverse signal can be
 * generated when the ordering of EMAs flips.
 */

/* eslint-disable no-console */

/**
 * Compute an exponential moving average for a series of values.  Uses
 * a simple recursive definition: EMA_t = alpha * price_t + (1 - alpha) * EMA_{t-1}.
 *
 * @param {number[]} values
 * @param {number} period
 * @returns {number}
 */
function ema(values, period) {
  if (!values || values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let emaPrev = values[0];
  for (let i = 1; i < values.length; i++) {
    emaPrev = alpha * values[i] + (1 - alpha) * emaPrev;
  }
  return emaPrev;
}

/**
 * Determine whether the EMAs of short, medium and long periods are
 * aligned.  Returns 1 for bullish alignment (short > medium > long),
 * -1 for bearish alignment (short < medium < long), and 0 for
 * undecided/mixed.
 *
 * @param {number[]} prices
 * @param {number[]} periods - [short, medium, long]
 * @returns {number}
 */
function trendAlignment(prices, periods = [10, 30, 60]) {
  if (prices.length < Math.max(...periods)) return 0;
  const [s, m, l] = periods;
  const emaS = ema(prices.slice(-s * 3), s);
  const emaM = ema(prices.slice(-m * 3), m);
  const emaL = ema(prices.slice(-l * 3), l);
  if (emaS > emaM && emaM > emaL) return 1;
  if (emaS < emaM && emaM < emaL) return -1;
  return 0;
}

/**
 * Compute a trailing stop price given the highest achieved price and a
 * trailing percentage.  For long positions, the stop sits below the
 * high by trailingPct; for shorts, above the low by trailingPct.
 * @param {number} extremePrice - highest (for long) or lowest (for short)
 * @param {number} trailingPct
 * @param {boolean} isLong
 */
function trailingStop(extremePrice, trailingPct = 0.02, isLong = true) {
  if (isLong) {
    return extremePrice * (1 - trailingPct);
  }
  return extremePrice * (1 + trailingPct);
}

module.exports = {
  ema,
  trendAlignment,
  trailingStop,
};