/**
 * Trend follower risk policy.
 *
 * Contains helpers for pyramiding and stop‑and‑reverse logic used by
 * the Trend Follower strategy.  Pyramiding adds fixed risk per add
 * when the trend continues in favour, while the SAR option flips the
 * position when the trend alignment reverses.  These helpers are pure
 * functions; side effects are handled in the main strategy body.
 */

/* eslint-disable no-console */

/**
 * Compute the risk allocation for the next add when pyramiding.  Each
 * add increases exposure by a fraction of the account equity.  The
 * function returns the maximum position size that should be added.
 *
 * @param {number} equity
 * @param {number} riskFraction
 * @param {number} currentRisk
 * @param {number} maxRisk
 * @returns {number}
 */
function nextPyramidAdd(equity, riskFraction = 0.01, currentRisk = 0, maxRisk = 0.05) {
  // If already above risk threshold, no more adds
  if (currentRisk >= maxRisk) return 0;
  const remaining = maxRisk - currentRisk;
  const addRisk = Math.min(remaining, riskFraction);
  return equity * addRisk;
}

/**
 * Determine whether a SAR (stop‑and‑reverse) should occur based on
 * previous and current trend directions.  Returns true if the trend
 * flips from bullish to bearish or vice versa.
 *
 * @param {number} prevDir - 1 = bullish, -1 = bearish, 0 = none
 * @param {number} currDir - 1 = bullish, -1 = bearish, 0 = none
 */
function shouldSAR(prevDir, currDir) {
  if (prevDir === 0 || currDir === 0) return false;
  return prevDir !== currDir;
}

module.exports = {
  nextPyramidAdd,
  shouldSAR,
};