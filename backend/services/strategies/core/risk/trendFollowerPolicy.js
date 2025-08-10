/**
 * Trend Follower risk management policy.
 *
 * Aligns stops with a rolling VWAP and implements simple exit
 * criteria.  A stop is suggested at 2.5% below both entry and the
 * current VWAP.  Exits are triggered when price falls 1% below the
 * VWAP or when momentum continuation attempts repeatedly fail.
 */
module.exports = {
  /**
   * Compute the next stop price for a trend follower position.
   *
   * @param {Object} position
   * @param {number} position.entryPrice - entry price of the trade
   * @param {number} position.vwap - current rolling VWAP
   * @returns {number|null} suggested stop price or null
   */
  nextStop(position = {}) {
    if (position.entryPrice == null || position.vwap == null) return null;
    const entry = Number(position.entryPrice);
    const vwap  = Number(position.vwap);
    const stopEntry = entry * (1 - 0.025);
    const stopVwap  = vwap  * (1 - 0.025);
    return Math.max(stopEntry, stopVwap);
  },

  /**
   * Determine whether the trend follower should exit.
   *
   * @param {Object} position
   * @param {number} [position.failedContinuations] - count of failed continuation attempts
   * @param {Object} market
   * @param {number} [market.price] - current trade price
   * @param {number} [market.vwap] - current rolling VWAP
   * @returns {boolean} true if exit conditions are met
   */
  shouldExit(position = {}, market = {}) {
    if (market.price != null && market.vwap != null) {
      if (market.price < market.vwap * (1 - 0.01)) {
        return true;
      }
    }
    if (typeof position.failedContinuations === 'number' && position.failedContinuations >= 2) {
      return true;
    }
    return false;
  },

  // Use the same TWAP ladder as breakout by default
  twapSlices: [0.2, 0.3, 0.5],
};