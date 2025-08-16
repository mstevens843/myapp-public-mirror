/**
 * getHighTradeCountList.js
 * ---------------------------------
 * Returns tokens with a high number of trades in the last hour. A large trade
 * count reflects strong market participation and may highlight assets with
 * active communities or bots【809305122257820†L37-L40】.
 */

try {
  require("dotenv").config({ path: __dirname + "/../../../.env" });
} catch (_) {
  /* dotenv is optional */
}
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/v3/token/list";

/**
 * Fetch tokens with high trade counts and sufficient volume. Filtering on
 * absolute volume helps avoid tokens manipulated by tiny trades. Sorting by
 * trade count surfaces the most active markets.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} minTrades1h - Minimum trade count over the last hour
 * @param {number} minVolume1h - Minimum 1h volume in USD
 */
async function getHighTradeCountList(
  userId = null,
  limit = 20,
  minTrades1h = 500,
  minVolume1h = 50_000
) {
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "trade_1h_count",
        sort_type: "desc",
        limit,
        min_trade_1h_count: minTrades1h,
        min_volume_1h_usd: minVolume1h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getHighTradeCountList error:", err.message);
    return [];
  }
}

module.exports = getHighTradeCountList;