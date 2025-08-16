/**
 * getRecentlyListedGoodLiquidityList.js
 * ---------------------------------
 * Returns recently listed tokens that have already achieved a baseline of
 * liquidity and trading volume. New listings can offer substantial upside,
 * but filtering for adequate liquidity helps avoid illiquid traps.
 */

try {
require("dotenv").config({ path: __dirname + "/../../../../.env" });
} catch (_) {
  /* dotenv is optional */
}
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/v3/token/list";

/**
 * Fetch recently listed tokens with minimum liquidity and volume.
 * The filter uses the current UNIX timestamp minus a given window (e.g. 48 hours)
 * to compute the minimum recent listing time. This dynamic calculation means
 * the list stays up to date each call.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} listingWindowHours - How far back to look for recent listings
 * @param {number} minLiquidity - Minimum liquidity in USD
 * @param {number} minVolume24h - Minimum 24h volume in USD
 */
async function getRecentlyListedGoodLiquidityList(
  userId = null,
  limit = 20,
  listingWindowHours = 48,
  minLiquidity = 100_000,
  minVolume24h = 50_000
) {
  limit = Math.max(1, Math.min(limit, 100));
  // Compute UNIX timestamp threshold: tokens listed after this time qualify.
  const nowSecs = Math.floor(Date.now() / 1000);
  const minListingTime = nowSecs - listingWindowHours * 3600;
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "recent_listing_time",
        sort_type: "desc",
        limit,
        min_recent_listing_time: minListingTime,
        min_liquidity: minLiquidity,
        min_volume_24h_usd: minVolume24h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getRecentlyListedGoodLiquidityList error:", err.message);
    return [];
  }
}

module.exports = getRecentlyListedGoodLiquidityList;