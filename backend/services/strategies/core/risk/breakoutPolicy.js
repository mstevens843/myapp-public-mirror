/**
 * Breakout risk management policy.
 *
 * Provides simple stop and exit logic suitable for breakout trades.
 * The hard stop is set two percent below entry.  Once a five percent
 * gain is locked in, a trailing stop three percent off the high is
 * activated.  Exit conditions monitor market midpoints and liquidity
 * floors.
 */
module.exports = {
  /**
   * Compute the next stop price for a breakout position.
   *
   * @param {Object} position - current trade state
   * @param {number} position.entryPrice - price at which the trade was opened
   * @param {number} [position.highestPrice] - highest observed price since entry
   * @returns {number|null} suggested stop level or null
   */
  nextStop(position = {}) {
    const entry = position.entryPrice;
    if (entry == null) return null;
    const entryNum = Number(entry);
    const highNum = position.highestPrice != null ? Number(position.highestPrice) : entryNum;
    const hardStop = entryNum * (1 - 0.02);
    let trailing = null;
    // Activate trailing stop only after locking in a 5% gain
    if (highNum >= entryNum * 1.05) {
      trailing = highNum * (1 - 0.03);
    }
    if (trailing != null) {
      return Math.max(hardStop, trailing);
    }
    return hardStop;
  },

  /**
   * Determine whether a breakout position should be exited early.
   *
   * @param {Object} position - unused placeholder for future state
   * @param {Object} market - aggregated market data
   * @param {number} [market.price] - current trade price
   * @param {number} [market.rollingMid] - rolling midpoint price
   * @param {number} [market.lpNow] - current liquidity level
   * @param {number} [market.lpFloor] - minimum acceptable liquidity
   * @returns {boolean} true if the trade should be closed
   */
  shouldExit(position = {}, market = {}) {
    // Exit if price breaks below the rolling mid by more than 1%
    if (market.price != null && market.rollingMid != null) {
      if (market.price < market.rollingMid * (1 - 0.01)) {
        return true;
      }
    }
    // Exit if liquidity dips below a configured floor
    if (market.lpNow != null && market.lpFloor != null) {
      if (market.lpNow < market.lpFloor) {
        return true;
      }
    }
    return false;
  },

  // Preferred TWAP slice ratios for breakout trades.  Execution
  // engines can consult this to decide how to apportion orders.
  twapSlices: [0.2, 0.3, 0.5],
};