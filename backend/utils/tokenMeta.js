// utils/tokenMeta.js
const fetch = require("node-fetch");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

async function getTokenNameFromBirdeye(mint) {
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/token/${mint}`, {
      headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY },
    });

    const json = await res.json();
    return json?.data?.name || "Unknown";
  } catch (err) {
    console.warn(`❌ Birdeye name fetch failed for ${mint}: ${err.message}`);
    return "Unknown";
  }
}

module.exports = { getTokenNameFromBirdeye };
