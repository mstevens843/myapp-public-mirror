/**
 * Signals stub for Breakout mode.
 *
 * This module is intended to pre-compute any custom signals used by the
 * breakout strategy ahead of time.  It runs asynchronously and should
 * never block the hot execution path.  Replace the body of this
 * function with your squeeze/expansion detection algorithm in future
 * iterations.
 *
 * @param {Object} cfg - the strategy configuration passed from the UI
 * @returns {Promise<Array>} an array of signal objects (currently empty)
 */
module.exports = async function generateBreakoutSignals(cfg = {}) {
  // TODO: compute breakout signals such as volatility squeezes, liquidity
  // pulls and subsequent expansions.  For now we return an empty list so
  // that the strategy can call this helper without impacting performance.
  return [];
};