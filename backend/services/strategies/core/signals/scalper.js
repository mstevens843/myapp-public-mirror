/**
 * Signals stub for Scalper mode.
 *
 * Scalper trades rely on very shortâ€‘horizon microstructure signals, such
 * as microâ€‘price imbalance, spread snapâ€‘backs and orderbook pings.  This
 * asynchronous helper is a placeholder for computing those signals
 * outside of the hot trading loop.  At present it returns an empty
 * array.  When implementing the real logic you should ensure that any
 * heavy computation or RPC calls are cached or throttled.
 *
 * @param {Object} cfg - the strategy configuration passed from the UI
 * @returns {Promise<Array>} an array of scalper signals (currently empty)
 */
module.exports = async function generateScalperSignals(cfg = {}) {
  // TODO: implement microstructure signal generation (e.g. orderbook depth
  // imbalance, spread snapbacks, cancel/replace bursts).  Keep this
  // function asynchronous and cache results where possible.  The stub
  // returns an empty array to avoid slowing down the strategy.
  return [];
};