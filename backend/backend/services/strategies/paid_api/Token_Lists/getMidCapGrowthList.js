/**
 * getMidCapGrowthList.js
 * ---------------------------------
 * Fetches a list of mid‑cap tokens with healthy daily volume. These projects
 * typically offer a balance between stability and growth potential: mid‑cap
 * assets have more room to grow than large‑caps yet are less risky than
 * small‑caps【809305122257820†L52-L59】.
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
 * Fetch mid‑cap tokens sorted by 24h volume. Filters on market cap and volume
 * to exclude tiny projects while still capturing upside potential.
 *
 * @param {string|null} userId
 * @param {number} limit
 * @param {number} minMarketCap - Minimum market cap (in USD) for a token to qualify
 * @param {number} maxMarketCap - Maximum market cap (in USD) for a token to qualify
 * @param {number} minVolume24h - Minimum 24h trading volume (in USD)
 */
async function getMidCapGrowthList(userId = null, limit = 20, minMarketCap = 50_000_000, maxMarketCap = 1_000_000_000, minVolume24h = 500_000) {
  limit = Math.max(1, Math.min(limit, 100));
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "volume_24h_usd",
        sort_type: "desc",
        limit,
        min_market_cap: minMarketCap,
        max_market_cap: maxMarketCap,
        min_volume_24h_usd: minVolume24h,
      },
      cuCost: CU_TABLE["/defi/v3/token/list"],
      userId,
    });
    const items = data?.data?.items || data?.data?.tokens || [];
    return items;
  } catch (err) {
    console.warn("❌ getMidCapGrowthList error:", err.message);
    return [];
  }
}

module.exports = getMidCapGrowthList;