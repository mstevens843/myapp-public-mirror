/**
 * Risk policy for Trend Follower mode.
 *
 * The trend follower should trail a rolling VWAP or moving average
 * rather than using static stops.  When momentum cools off for a
 * sustained period the position should be exited and the strategy
 * should observe a cool‑off before re‑entering.
 */

module.exports = {
  /**
   * Calculate the next trailing stop based on the rolling VWAP.
   *
   * @param {Object} position - details of the current position
   * @param {number} position.entryPrice - the entry price
   * @param {number} position.vwap - the rolling volume weighted average price
   * @returns {number|null} the new stop or null if unchanged
   */
  nextStop(position) {
    // TODO: set the stop to a percentage below the rolling VWAP
    // to allow the trend to breathe while cutting losses when
    // momentum reverses.  Currently returns null to leave the stop
    // unchanged.
    return null;
  },

  /**
   * Determine whether the trend follower should exit due to
   * deteriorating momentum or violations of risk limits.
   *
   * @param {Object} position - information about the open position
   * @param {Object} market - aggregated trend metrics
   * @param {number} coolOffCount - number of failed continuations
   * @returns {boolean} true if the trade should be closed
   */
  shouldExit(position, market, coolOffCount) {
    // TODO: implement exit logic based on momentum slowdown or
    // increasing net selling.  The coolOffCount can be used to
    // enforce a cool‑off period after two failed trend continuations.
    return false;
  },
};