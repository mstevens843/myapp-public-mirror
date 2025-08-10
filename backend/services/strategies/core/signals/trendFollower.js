/**
 * Trend Follower signal generator.
 *
 * Computes simple momentum metrics over a rolling set of ticks.  A
 * tick should describe the direction of trade (up/down) and its
 * signed size.  When the net flow is positive and more than 60% of
 * the ticks are up, an uptrend signal is emitted.  Conversely, when
 * the net flow is negative and down ticks dominate, a downtrend
 * signal is emitted.  This helper is synchronous and suitable for
 * repeated invocation in tight loops.
 *
 * Each element of `state.ticks` is expected to be an object with at
 * least a numeric `size` and a `direction` ("up"|"down") or `side`
 * ("buy"|"sell").  Unknown directions default to down.
 *
 * @param {Object} state input containing a `ticks` array
 * @returns {Array<Object>} array of signals
 */
module.exports = function trendFollowerSignals(state = {}) {
  const signals = [];
  const ticks = Array.isArray(state.ticks) ? state.ticks : [];
  const total = ticks.length;
  if (total === 0) return signals;
  let netFlow = 0;
  let upCount = 0;
  let downCount = 0;
  for (const tick of ticks) {
    const size = Number(tick.size || 0);
    const dir = (tick.direction || tick.side || '').toLowerCase();
    if (dir === 'up' || dir === 'buy') {
      netFlow += size;
      upCount++;
    } else {
      netFlow -= size;
      downCount++;
    }
  }
  const upBias = upCount / total;
  const downBias = downCount / total;
  if (netFlow > 0 && upBias > 0.6) {
    signals.push({ type: 'uptrend' });
  } else if (netFlow < 0 && downBias > 0.6) {
    signals.push({ type: 'downtrend' });
  }
  return signals;
};