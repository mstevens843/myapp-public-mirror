/**
 * getTokenVolumeJupiter.js
 * ---------------------------------
 * Fetches real 24h USD trading volume via Jupiter Token API.
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");

const cache = new Map();
const TTL_MS = 60_000;

async function getTokenVolumeJupiter(mint) {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.volume;

  try {
    const url = `https://tokens.jup.ag/token/${mint}`;
    const { data } = await axios.get(url, { timeout: 6000 });

    const volume = Number(data?.daily_volume || 0);
    cache.set(mint, { ts: Date.now(), volume });
    return volume;
  } catch (err) {
    console.warn(`⚠️ getTokenVolumeJupiter failed for ${mint}:`, err.message);
    return 0;
  }
}

module.exports = getTokenVolumeJupiter;
