/**
 * getTrendingTokens.js
 * ---------------------------------
 * Fetches trending tokens sorted by rank from Birdeye.
 * Useful for momentum or post-launch follow-through plays.
 */

require("dotenv").config({ path: __dirname + "/../../../../.env" });
const { birdeyeCUCounter } = require("../birdeyeCUCounter");
const CU_TABLE = require("../cuTable");

const URL = "https://public-api.birdeye.so/defi/token_trending";

/**
 * getTrendingTokensList
 * 
 * @param {string|null} userId - User ID for CU tracking
 * @param {number} limit - Max number of tokens
 * @param {number} offset - Pagination offset
 */
async function getTrendingTokensList(userId = null, limit = 20, offset = 0) {
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "rank",
        sort_type: "asc",
        limit,
        offset,
      },
      cuCost: CU_TABLE["/defi/token_trending"], // centralized CU cost
      userId,
    });

    const tokens = data?.data?.tokens || [];
    return tokens;

  } catch (err) {
    console.warn("❌ getTrendingTokens failed:", err.message);
    return [];
  }
}

module.exports = getTrendingTokensList;
