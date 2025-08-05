require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const axios = require("axios");
const prisma = require("../../../prisma/prisma");
const CU_TABLE = require("./cuTable");

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

/**
 * Makes a Birdeye API request and meters CU usage for a given user.
 * Applies default CU=10 if endpoint is unknown.
 *
 * @param {string} url - The Birdeye endpoint URL
 * @param {Object} params - Query parameters
 * @param {number|null} cuCost - CU cost to charge for this request (optional)
 * @param {string|null} userId - ID of the user making the request
 * @returns {Object} - The raw response data from Birdeye
 */
async function birdeyeCUCounter({ url, params = {}, cuCost = null, userId = null }) {
  try {
    const urlPath = new URL(url).pathname;

    // Auto‑resolve CU cost from CU_TABLE or fallback
    let finalCuCost = cuCost;
    if (finalCuCost == null) {
      finalCuCost = CU_TABLE[urlPath] ?? 10;  // ✅ default to 10 if unknown
    }

    const response = await axios.get(url, {
      params,
      headers: {
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
      },
      timeout: 5000,
    });

if (userId && typeof userId === "string") {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { usage: { increment: finalCuCost } },
    });
  } catch (err) {
    console.warn(`⚠️ Could not update CU for userId ${userId}:`, err.message);
  }
}

    return response.data;
  } catch (err) {
    console.warn(`⚠️ Birdeye request failed: ${url}`, err.message);
    throw err;
  }
}

module.exports = { birdeyeCUCounter };
