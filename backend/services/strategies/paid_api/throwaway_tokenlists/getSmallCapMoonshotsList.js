/**
 * getSmallCapMoonshotsList.js
 * ---------------------------------
 * Returns small‑cap tokens experiencing notable price momentum and trading
 * activity. Small‑cap assets generally have higher risk but potentially higher
 * returns compared with large‑cap coins【809305122257820†L52-L59】.
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
 * Fetch small‑cap tokens with strong 1h price momentum and reasonable
 * volume. We filter by market cap, volume and price change. Sorting by
 * 1h price change brings the highest‑momentum names to the top, helping
 * traders capture short‑term breakouts【809305122257820†L73-L82】.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} maxMarketCap - Maximum market cap in USD
 * @param {number} minVolume24h - Minimum 24h volume in USD
 * @param {number} minPriceChange1h - Minimum price change percentage over the last hour
 */
async function getSmallCapMoonshotsList(
  userId = null,
  limit = 20,
  maxMarketCap = 50_000_000,
  minVolume24h = 200_000,
  minPriceChange1h = 5
) {
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "price_change_1h_percent",
        sort_type: "desc",
        limit,
        max_market_cap: maxMarketCap,
        min_volume_24h_usd: minVolume24h,
        min_price_change_1h_percent: minPriceChange1h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getSmallCapMoonshotsList error:", err.message);
    return [];
  }
}

module.exports = getSmallCapMoonshotsList;