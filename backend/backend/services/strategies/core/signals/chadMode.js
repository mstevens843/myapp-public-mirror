/**
 * Signals stub for Chad Mode.
 *
 * Chad Mode is designed as a manual, discretionary trading mode with
 * optional guardrails.  There is no automated signal generation in
 * this mode; the user decides when to enter.  The stub is provided
 * for symmetry with other modes and always returns an empty array.
 *
 * @param {Object} cfg - the strategy configuration passed from the UI
 * @returns {Promise<Array>} an empty array
 */
module.exports = async function generateChadModeSignals(cfg = {}) {
  return [];
};