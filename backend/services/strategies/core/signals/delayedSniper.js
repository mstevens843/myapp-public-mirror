/**
 * Delayed Sniper signal helpers.
 *
 * Provides warm‑up ramp detection and token age gates for the Delayed
 * Sniper strategy.  Instead of blindly sleeping after a token
 * launches, this strategy waits for liquidity to appear, volume to
 * increase and a breakout–pullback–continuation sequence to play out.
 */

/* eslint-disable no-console */

/**
 * Determine whether a token satisfies the warm‑up ramp sequence:
 * 1. An initial breakout above `breakoutPct` within the first window.
 * 2. A modest pullback no more than `pullbackPct` below the breakout.
 * 3. A subsequent continuation above the breakout high.
 *
 * Receives an array of price samples ordered oldest→latest.
 *
 * @param {number[]} prices
 * @param {object} opts
 * @param {number} opts.breakoutPct
 * @param {number} opts.pullbackPct
 * @returns {boolean}
 */
function checkWarmUpRamp(prices, opts = {}) {
  const { breakoutPct = 0.3, pullbackPct = 0.1 } = opts;
  if (!prices || prices.length < 5) return false;
  const initial = prices[0];
  const breakoutLevel = initial * (1 + breakoutPct);
  // Find index where breakout occurs
  let breakoutIndex = -1;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] >= breakoutLevel) {
      breakoutIndex = i;
      break;
    }
  }
  if (breakoutIndex < 0 || breakoutIndex + 2 >= prices.length) return false;
  const maxAfterBreakout = Math.max(...prices.slice(0, breakoutIndex + 1));
  // Pullback: price dips but not too far below breakout
  const pullbackIndex = breakoutIndex + 1;
  const pullback = prices[pullbackIndex];
  if (pullback > maxAfterBreakout * (1 - pullbackPct)) return false;
  // Continuation: price exceeds previous high
  for (let i = pullbackIndex + 1; i < prices.length; i++) {
    if (prices[i] > maxAfterBreakout) return true;
  }
  return false;
}

/**
 * Token age gate.  Returns true if the token age (in minutes) falls
 * between a minimum and maximum.  When outside the range the strategy
 * should skip the token.
 *
 * @param {number} ageMinutes
 * @param {number|null} minAge
 * @param {number|null} maxAge
 * @returns {boolean}
 */
function checkAgeGate(ageMinutes, minAge = null, maxAge = null) {
  if (minAge != null && ageMinutes < minAge) return false;
  if (maxAge != null && ageMinutes > maxAge) return false;
  return true;
}

module.exports = {
  checkWarmUpRamp,
  checkAgeGate,
};