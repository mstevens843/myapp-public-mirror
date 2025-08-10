/**
 * Signals stub for Trend Follower mode.
 *
 * Trend following strategies often monitor rolling net flow, tick
 * migration and other aggregate market measures over a medium horizon
 * (tens to hundreds of slots).  This helper should compute those
 * quantities ahead of time and cache them for the strategy loop.  The
 * current implementation is a no‑op that returns an empty list.
 *
 * @param {Object} cfg - the strategy configuration passed from the UI
 * @returns {Promise<Array>} an array of trend signals (currently empty)
 */
module.exports = async function generateTrendFollowerSignals(cfg = {}) {
  // TODO: calculate rolling net buy pressure, active‑tick migrations and
  // similar metrics.  The stub returns an empty array for now so
  // callers can await it without incurring overhead.
  return [];
};