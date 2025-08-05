/**
 * getTokenPriceChange.js
 * ---------------------------------
 * Fetches price change (1h or 24h) from Birdeye `/defi/price`
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");
console.log("Birdeye Key:", process.env.BIRDEYE_API_KEY);
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const cache = new Map(); // mint|interval → { ts, pct }
const TTL_MS = 60_000;

async function getTokenPriceChange(mint, interval = 24) {
  const key = `${mint}:${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.pct;

  try {
    const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
      params: { address: mint },
      headers: {
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
      },
      timeout: 6000,
    });

    const field = interval === 1 ? "priceChange1h" : "priceChange24h";
    const pct = Number(data?.data?.[field] ?? 0) / 100;

    cache.set(key, { ts: Date.now(), pct });
    return pct;
  } catch (err) {
    console.warn(`⚠️ getTokenPriceChange failed for ${mint}:`, err.message);
    return 0;
  }
}


module.exports = getTokenPriceChange;



/**
 * Minimal patch
js
Copy
Edit
// api/getTokenPriceChange.js
const fieldMap = { 1: "priceChange1h", 24: "priceChange24h" };
const field    = fieldMap[interval] || "priceChange24h";
const raw      = data?.data?.[field];

// Fallback – if 1 h is unavailable use 24 h,
// and if that’s still undefined, synthesise it
let pct = Number(raw);
if (!pct && interval === 1) {
  const hist = await axios.get("https://public-api.birdeye.so/defi/history_price", {
    params  : { address: mint, timeframe: 3600 },
    // headers : { /*…*/ },
//   });
//   const first = hist.data?.data?.items?.[0]?.value;
//   const last  = hist.data?.data?.items?.slice(-1)[0]?.value;
//   pct = first ? ((last - first) / first) * 100 : 0;
// }
// return pct / 100;
// Result: price change will only be zero when the token truly hasn’t moved.
//  */