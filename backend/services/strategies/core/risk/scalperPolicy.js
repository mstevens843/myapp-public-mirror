/**
 * Scalper risk management policy.
 *
 * Enforces extremely tight stops and time based exits suitable for
 * ultra short term trades.  The suggested stop is two tenths of a
 * percent below entry.  Positions are forcibly exited after three
 * slots or when cancel/replace attempts fail.
 */
module.exports = {
  /**
   * Compute the next stop price for a scalper position.
   *
   * @param {Object} position
   * @param {number} position.entryPrice - price at which the position was opened
   * @returns {number|null} suggested stop or null
   */
  nextStop(position = {}) {
    if (position.entryPrice == null) return null;
    const entry = Number(position.entryPrice);
    // 0.2% trailing stop
    return entry * (1 - 0.002);
  },

  /**
   * Determine whether the scalper should exit immediately.
   *
   * @param {Object} position - state of the current trade
   * @param {boolean} [position.cancelFailed] - whether cancel order failed
   * @param {boolean} [position.replaceFailed] - whether replace order failed
   * @param {number} [position.slotsHeld] - number of slots the position has been open
   * @returns {boolean} true if exit conditions are met
   */
  shouldExit(position = {}, market = {}) {
    if (position.cancelFailed || position.replaceFailed) {
      return true;
    }
    if (typeof position.slotsHeld === 'number' && position.slotsHeld >= 3) {
      return true;
    }
    return false;
  },

  // For scalper trades the execution should finish within three slots.
  timeStopSlots: 3,
};