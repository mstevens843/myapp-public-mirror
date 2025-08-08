/**
 * getTokenPriceChange.js (updated)
 * ---------------------------------
 * Wraps the enhanced marketData.getTokenPriceChange. Accepts a mint
 * and optional interval (1 or 24 hours) and returns the decimal
 * percentage change. Catches underlying errors and falls back to
 * returning zero to mirror the original behaviour on failure.
 */

const { getTokenPriceChange: fetchChange } = require('../../../utils/marketData');

async function getTokenPriceChange(mint, interval = 24) {
  try {
    return await fetchChange(mint, interval);
  } catch (_) {
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
    // headers : { /*…*/
//   const first = hist.data?.data?.items?.[0]?.value;
//   const last  = hist.data?.data?.items?.slice(-1)[0]?.value;
//   pct = first ? ((last - first) / first) * 100 : 0;
// }
// return pct / 100;
// Result: price change will only be zero when the token truly hasn’t moved.
//  */