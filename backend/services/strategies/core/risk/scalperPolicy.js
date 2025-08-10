/**
 * Scalper risk policy.
 *
 * Houses simple risk management helpers for the Scalper strategy.  The
 * scalper operates on extremely short time horizons and must enforce
 * strict hold times, tight take profit/stop loss levels, and
 * micro‑position sizing.  The helpers below encapsulate these
 * constraints and provide convenience methods for computing targets
 * given a starting price and configured risk parameters.
 */

/* eslint-disable no-console */

/**
 * Compute take profit and stop loss levels given an entry price.
 * Accepts decimals (e.g., 0.02 = 2%) and returns absolute price levels.
 *
 * @param {number} entryPrice
 * @param {number} takeProfitPct
 * @param {number} stopLossPct
 */
function computeTpSl(entryPrice, takeProfitPct = 0.01, stopLossPct = 0.005) {
  const tp = entryPrice * (1 + takeProfitPct);
  const sl = entryPrice * (1 - stopLossPct);
  return { takeProfit: tp, stopLoss: sl };
}

/**
 * Determine whether a position should be forcefully closed due to
 * exceeding the maximum hold time.  The scalper aims to be in and out
 * quickly; any positions older than this threshold are closed
 * regardless of PnL.
 *
 * @param {number} entryTimestamp - milliseconds since epoch
 * @param {number} maxHoldSeconds
 */
function shouldForceClose(entryTimestamp, maxHoldSeconds = 30) {
  const ageMs = Date.now() - entryTimestamp;
  return ageMs > maxHoldSeconds * 1000;
}

/**
 * Compute the next ladder size for partial DCA when adding to a
 * position.  The scalper often pyramids into small mean‑reversion moves
 * with a fixed risk per add.  Returns an amount (in base currency) that
 * does not exceed the per‑add risk.
 *
 * @param {number} accountBalance
 * @param {number} riskPerAddPct
 */
function nextPositionSize(accountBalance, riskPerAddPct = 0.005) {
  return accountBalance * riskPerAddPct;
}

module.exports = {
  computeTpSl,
  shouldForceClose,
  nextPositionSize,
};