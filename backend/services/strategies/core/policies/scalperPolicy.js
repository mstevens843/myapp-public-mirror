/**
 * Risk policy for Breakout mode.
 *
 * Breakout trades typically start with a very tight initial stop and
 * convert to a trailing stop once a predefined profit threshold has
 * been locked in.  This stub exposes two pure functions —
 * `nextStop` and `shouldExit` — that accept relevant state and
 * determine the next stop level or whether a position should be
 * exited.  Real implementations should avoid side effects and
 * expensive operations so they can be invoked from the hot path.
 */

module.exports = {
  /**
   * Compute the next stop price based on the current position state.
   *
   * @param {Object} position - information about the open position
   * @param {number} position.entryPrice - the entry price of the trade
   * @param {number} position.highestPrice - the highest price since entry
   * @returns {number|null} the new stop price or null if unchanged
   */
  nextStop(position) {
    // TODO: implement tight initial stop and trailing stop logic.
    // For example, move the stop to breakeven plus a buffer once
    // highestPrice exceeds entryPrice by a certain multiple of risk.
    return null;
  },

  /**
   * Decide whether the position should be exited early.
   *
   * @param {Object} position - information about the open position
   * @param {Object} market - aggregated market data for the asset
   * @returns {boolean} true if the trade should be closed
   */
  shouldExit(position, market) {
    // TODO: evaluate breakout exit conditions.  This might include
    // checking if momentum has stalled, if liquidity has dried up or
    // if adverse price action has appeared.  For now, never exit.
    return false;
  },
};