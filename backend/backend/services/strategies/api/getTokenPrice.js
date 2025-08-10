/**
 * getTokenPrice.js (updated)
 * ---------------------------------
 * Thin wrapper around the enhanced marketData.getTokenPrice. Accepts
 * a mint and optionally additional unused parameters (e.g. userId) and
 * returns the latest price. Errors from the underlying market data
 * module are caught and converted into a zero value to preserve
 * backwards compatibility with callers that expect a numeric return.
 */

const { getTokenPrice: fetchPrice, getSolPrice } = require('../../../utils/marketData');

/**
 * Retrieve the latest price for a given mint. If more than one
 * argument is passed the first is ignored and the second is taken
 * as the mint, mirroring the original function signature used
 * throughout the codebase (userId, mint).
 *
 * @param {...any} args (userId?, mint)
 * @returns {Promise<number>}
 */
async function getTokenPrice(...args) {
  // The mint is the last argument
  const mint = args[args.length - 1];
  try {
    return await fetchPrice(mint);
  } catch (_) {
    // Price unavailable – preserve original fallback behaviour
    return 0;
  }
}

module.exports = getTokenPrice;