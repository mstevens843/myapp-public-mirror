/**
 * getTokenVolumeJupiter.js (updated)
 * ---------------------------------
 * Delegates volume retrieval to the enhanced marketData.getTokenVolume.
 * Returns a numeric volume (USD) and falls back to zero on error.
 */

const { getTokenVolume: fetchVolume } = require('../../../utils/marketData');

async function getTokenVolumeJupiter(mint) {
  try {
    return await fetchVolume(mint);
  } catch (_) {
    return 0;
  }
}

module.exports = getTokenVolumeJupiter;