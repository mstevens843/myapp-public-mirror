/**
 * getTokenPriceChangeJupiter.js
 * ---------------------------------
 * Fetches 1h and 24h price change % from Jupiter Token API.
 * Returns: { change1h: 0.0123, change24h: -0.045 }
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");

const cache = new Map();
const TTL_MS = 60_000;

async function getTokenPriceChangeJupiter(mint) {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  try {
    const { data } = await axios.get(`https://tokens.jup.ag/token/${mint}`, {
      timeout: 6000,
    });

    const change1h = Number(data?.price_change_1h ?? 0) / 100;
    const change24h = Number(data?.price_change_24h ?? 0) / 100;

    const result = { change1h, change24h };
    cache.set(mint, { ts: Date.now(), data: result });

    return result;
  } catch (err) {
    console.warn(`⚠️ getTokenPriceChangeJupiter failed for ${mint}:`, err.message);
    return { change1h: 0, change24h: 0 };
  }
}

module.exports = getTokenPriceChangeJupiter;
