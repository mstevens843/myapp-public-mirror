/**
 * Chad Mode risk management policy.
 *
 * Provides minimal guardrails for manual mode.  A bracket based stop
 * and take profit may be honoured if supplied on the position.  Exit
 * conditions implement a simple equity throttle; if drawdown exceeds
 * a threshold, the policy recommends closure.
 */
module.exports = {
  /**
   * Compute the next stop price for a chad mode position.
   *
   * @param {Object} position
   * @param {number} [position.takeProfit] - user supplied take profit level
   * @param {number} [position.stopLoss] - user supplied stop loss level
   * @returns {number|null} next stop level or null
   */
  nextStop(position = {}) {
    if (typeof position.takeProfit === 'number') {
      return position.takeProfit;
    }
    if (typeof position.stopLoss === 'number') {
      return position.stopLoss;
    }
    return null;
  },

  /**
   * Determine whether the chad mode position should exit.
   *
   * @param {Object} position
   * @param {number} [position.equityDrawdown] - fractional drawdown (e.g. 0.2 for 20%)
   * @returns {boolean} true if the policy advises exiting
   */
  shouldExit(position = {}, market = {}) {
    if (typeof position.equityDrawdown === 'number' && position.equityDrawdown > 0.2) {
      return true;
    }
    return false;
  },
};