// services/safety/birdeyeTopHolderCheck.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const axios = require("axios");

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_HEADERS = {
  "x-api-key": BIRDEYE_API_KEY,
  "x-chain": "solana",
  "accept": "application/json",
};

const CACHE = new Map(); // mint → { t, result }

/**
 * Checks if the top token holder owns more than 20% of all listed holders in top 100.
 */
async function checkBirdeyeTopHolderRisk(mint) {
  try {
    const now = Date.now();
    const cached = CACHE.get(mint);
    if (cached && now - cached.t < 30_000) return cached.result;

    const url = `https://public-api.birdeye.so/defi/v3/token/holder?address=${mint}&offset=0&limit=100`;
    const { data } = await axios.get(url, {
      headers: BIRDEYE_HEADERS,
      timeout: 6000,
    });

    const holders = data?.data?.items;
    if (!Array.isArray(holders) || holders.length === 0) {
      throw new Error("No holders returned from Birdeye");
    }

    const totalHeld = holders.reduce((sum, h) => sum + h.ui_amount, 0);
    const topHolder = holders[0].ui_amount;
    const dominance = topHolder / totalHeld;

    const passed = dominance < 0.20;
    const result = passed
      ? {
          passed: true,
          topHolderPct: (dominance * 100).toFixed(2) + "%",
        }
      : {
          passed: false,
          topHolderPct: (dominance * 100).toFixed(2) + "%",
          error: `Top holder owns ${ (dominance * 100).toFixed(2) }%`,
        };

    CACHE.set(mint, { t: now, result });
    return result;
  } catch (err) {
    console.error("❌ Birdeye Top Holder Check Error:", err.message);
    return { passed: false, error: "Birdeye API failed: " + err.message };
  }
}

module.exports = { checkBirdeyeTopHolderRisk };