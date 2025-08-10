const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const URL = "https://public-api.birdeye.so/defi/token_creation_info";

/**
 * Gets the token creation time from Birdeye.
 * Charges CU cost from CU_TABLE.
 *
 * @param {string} mint - Token mint address
 * @param {string|null} userId - User ID for CU tracking
 * @returns {number} - Block Unix time or 0 if unknown
 */
async function getTokenCreationTime(mint, userId = null) {
  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: { address: mint },
      cuCost: CU_TABLE["/defi/token_creation_info"],  // ← from centralized table
      userId,
    });

    return Number(data?.data?.blockUnixTime || 0);
  } catch (err) {
    console.warn("creation-info error", mint, err.message);
    return 0; // treat as “unknown”
  }
}

module.exports = getTokenCreationTime;
