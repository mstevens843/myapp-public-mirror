require("dotenv").config({ path: __dirname + "/../../../../.env" });
const { birdeyeCUCounter } = require("../birdeyeCUCounter");
const CU_TABLE = require("../cuTable");

const URL = "https://public-api.birdeye.so/defi/v2/tokens/new_listing";

/**
 * getNewListings
 * @param {string} userId - the ID of the user making the call
 * @param {number} limit
 * @param {boolean} includeMeme
 */
async function getNewListings(userId = null, limit = 20, includeMeme = true) {
  limit = Math.min(limit, 20); // Starter plan hard-cap

  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        limit,
        meme_platform_enabled: includeMeme,
      },
      cuCost: CU_TABLE["/defi/new_listing"], // centralized CU cost
      userId,
    });

    const list = data?.data?.tokens || data?.data?.items || [];
    return list;

  } catch (err) {
    console.warn("❌ getNewListings failed:", err.message);
    return [];
  }
}

module.exports = getNewListings;
