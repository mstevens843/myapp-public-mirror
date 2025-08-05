/**
 * getTokenVolume.js
 * ---------------------------------
 * Wraps Birdeye 24h volume endpoint with simple cache.
 *
 * Returns **daily volume in USD** (number).
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");
console.log("Birdeye Key:", process.env.BIRDEYE_API_KEY);
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const ENDPOINT = "https://public-api.birdeye.so/public/volume?address={MINT}";
const cache = new Map();
const TTL_MS = 60_000;

async function getTokenVolume(mint) {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.vol;

  try {
    const url = ENDPOINT.replace("{MINT}", mint);
    const { data } = await axios.get(url, {
      headers: { "x-chain": "solana", "X-API-KEY": BIRDEYE_API_KEY },
      timeout: 6000,
    });

    const vol = Number(data?.data?.value || 0);
    cache.set(mint, { ts: Date.now(), vol });
    return vol;
  } catch (err) {
    console.warn(`⚠️ getTokenVolume failed for ${mint}:`, err.message);
    return 0;
  }
};

module.exports = getTokenVolume