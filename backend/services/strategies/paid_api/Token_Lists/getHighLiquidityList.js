/**
 * getHighLiquidityList.js
 * ---------------------------------
 * Returns a list of high‑liquidity tokens with substantial 24h volume.
 * High liquidity and volume indicate strong market interest and easier trade execution,
 * reducing slippage and ensuring stability【809305122257820†L33-L40】.
 */

// Attempt to load environment variables only if dotenv is available. This avoids runtime
// errors if the module is missing in certain deployments.
try {
require("dotenv").config({ path: __dirname + "/../../../../.env" });
} catch (_) {
  /* no‑op */
}
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

// V3 token list endpoint
const URL = "https://public-api.birdeye.so/defi/v3/token/list";

/**
 * Fetch high‑liquidity tokens sorted by liquidity. Only include tokens with
 * significant liquidity and volume in the last 24 hours. This list is suitable
 * for strategies targeting blue‑chip or established tokens with strong market
 * participation.
 *
 * @param {string|null} userId - User ID for CU tracking
 * @param {number} limit - Maximum number of tokens to return (1–100)
 * @param {number} minLiquidity - Minimum liquidity threshold in USD
 * @param {number} minVolume24h - Minimum 24h volume threshold in USD
 * @returns {Array<Object>} List of token objects
 */
async function getHighLiquidityList(userId = null, limit = 20, minLiquidity = 1_000_000, minVolume24h = 1_000_000) {
  // Constrain limit to the API bounds
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "liquidity",
        sort_type: "desc",
        limit,
        min_liquidity: minLiquidity,
        min_volume_24h_usd: minVolume24h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getHighLiquidityList error:", err.message);
    return [];
  }
}

module.exports = getHighLiquidityList;