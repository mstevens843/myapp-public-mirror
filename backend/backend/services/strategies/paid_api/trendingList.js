require("dotenv").config({ path: __dirname + "/../../../.env" });
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const URL = "https://public-api.birdeye.so/defi/token_trending";

/**
 * Fetch trending tokens from Birdeye API
 * @param {Object} options
 * @param {string} options.sort_by - e.g. "rank", "volume24hUSD"
 * @param {string} options.sort_type - "asc" or "desc"
 * @param {number} [options.offset=0]
 * @param {number} [options.limit=20]
 * @param {string|null} [options.userId] - user ID for CU tracking
 * @returns {Promise<Object[]>} array of token objects
 */
async function getTrendingTokens({
  sort_by,
  sort_type,
  offset = 0,
  limit = 20,
  userId = null,
}) {
  try {
    const params = { sort_by, sort_type, offset, limit };

    const data = await birdeyeCUCounter({
      url: URL,
      params,
      cuCost: CU_TABLE["/defi/token_trending"], // centralized CU cost
      userId,
    });

    if (data?.success) {
      return data.data.tokens;
    } else {
      console.error("Unexpected response from Birdeye:", data);
      return [];
    }
  } catch (err) {
    console.error("Failed to fetch trending tokens:", err.message);
    return [];
  }
}

module.exports = getTrendingTokens;


// If you want, we can also:
//
// Add a caching layer (to limit API calls / save Birdeye quota).
//
// Automatically default to sort_by=rank + sort_type=asc.
//
// Or write this as an Express route like /api/trending.
