/**
 * Scalper signal generator.
 *
 * Evaluates near‑term order book imbalance and spread conditions to
 * produce microstructure signals suitable for high‑frequency scalp
 * strategies.  The function is synchronous and deliberately simple.
 *
 * Recognised keys on the `state` object:
 *  - bids:   cumulative size of the top five bid levels
 *  - asks:   cumulative size of the top five ask levels
 *  - spread: current best bid/ask spread
 *  - snapMax: maximum spread considered acceptable for a trade
 *  - orderbook: optional full structure { bids: [{size}], asks: [{size}], spread, snapMax }
 *
 * A depth imbalance signal is emitted when the top‑5 bid depth
 * materially exceeds the top‑5 ask depth (>20%) and the spread is
 * narrower than the configured snapMax.  Additional CLMM style
 * signals could be added here in future iterations.
 *
 * @param {Object} state inputs for microstructure calculations
 * @returns {Array<Object>} array of detected signals
 */
module.exports = function scalperSignals(state = {}) {
  const signals = [];
  // If an aggregate of the top five bid/ask depths is provided
  if (typeof state.bids === 'number' && typeof state.asks === 'number' && (state.bids + state.asks) !== 0) {
    const imbalance = (state.bids - state.asks) / (state.bids + state.asks);
    if (
      imbalance > 0.2 &&
      state.spread != null &&
      state.snapMax != null &&
      state.spread < state.snapMax
    ) {
      signals.push({ type: 'depthImbalance' });
    }
  } else if (state.orderbook && Array.isArray(state.orderbook.bids) && Array.isArray(state.orderbook.asks)) {
    // Compute depth imbalance from an explicit orderbook
    const topBids = state.orderbook.bids
      .slice(0, 5)
      .reduce((sum, lvl) => sum + (Number(lvl.size) || 0), 0);
    const topAsks = state.orderbook.asks
      .slice(0, 5)
      .reduce((sum, lvl) => sum + (Number(lvl.size) || 0), 0);
    const denom = topBids + topAsks;
    if (denom > 0) {
      const ratio = (topBids - topAsks) / denom;
      const spread = state.orderbook.spread;
      const snapMax = state.orderbook.snapMax;
      if (ratio > 0.2 && spread != null && snapMax != null && spread < snapMax) {
        signals.push({ type: 'depthImbalance' });
      }
    }
  }
  // Placeholder for potential CLMM thin‑depth or other exotic checks
  return signals;
};