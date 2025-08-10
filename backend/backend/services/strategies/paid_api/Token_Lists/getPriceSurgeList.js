/**
 * getPriceSurgeList.js
 * ---------------------------------
 * Returns tokens that have seen a sharp price increase in the past couple of hours.
 * Monitoring short‑term price changes helps traders spot momentum trends and
 * respond quickly【809305122257820†L73-L82】.
 */

try {
  require("dotenv").config({ path: __dirname + "/../../../.env" });
} catch (_) {
  /* dotenv is optional */
}
const CU_TABLE = require("./cuTable");
const { birdeyeCUCounter } = require("./birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/v3/token/list";

/**
 * Fetch tokens with strong 2h price momentum and minimum trade and volume
 * thresholds. Sorting by 2h price change surfaces tokens making recent
 * moves.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} minPriceChange2h - Minimum 2h price change percentage
 * @param {number} minVolume2h - Minimum 2h volume in USD
 * @param {number} minTrades2h - Minimum number of trades in the last 2 hours
 */
async function getPriceSurgeList(
  userId = null,
  limit = 20,
  minPriceChange2h = 10,
  minVolume2h = 50_000,
  minTrades2h = 100
) {
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "price_change_2h_percent",
        sort_type: "desc",
        limit,
        min_price_change_2h_percent: minPriceChange2h,
        min_volume_2h_usd: minVolume2h,
        min_trade_2h_count: minTrades2h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getPriceSurgeList error:", err.message);
    return [];
  }
}

module.exports = getPriceSurgeList;