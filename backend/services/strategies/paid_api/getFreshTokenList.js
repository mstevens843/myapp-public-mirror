/**
 * getFreshTokenList.js
 * ---------------------------------
 * Fetches token list sorted by 24h volume with liquidity filter.
 * Ideal for sniper bot scanning.
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const CU_TABLE = require("./cuTable");
const { birdeyeCUCounter } = require("./birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/tokenlist";
const CACHE_TTL = 5 * 60 * 1000;

let cachedTokens = [];
let lastFetched = 0;

async function getFreshTokenList(userId = null, limit = 50, minLiquidity = 500) {
  const now = Date.now();

limit = Math.max(1, Math.min(limit, 100)); // ✅ reasonable bounds

  if (cachedTokens.length && now - lastFetched < CACHE_TTL) {
    return cachedTokens;
  }

  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        sort_by: "v24hUSD",
        sort_type: "desc",
        limit,
        min_liquidity: minLiquidity,
        offset: 0,a
      },
      cuCost: CU_TABLE["/defi/tokenlist"],
      userId,
    });

    const tokenList = data?.data?.tokens || [];
const mintsOnly = tokenList.map((t) => t?.address).filter(Boolean);
console.log("📦 getFreshTokenList(): returning", mintsOnly);
    cachedTokens = mintsOnly;
    lastFetched = now;

    return mintsOnly;
  } catch (err) {
    console.warn("❌ getFreshTokenList error:", err.message);
    return cachedTokens.length ? cachedTokens : [];
  }
}
module.exports = getFreshTokenList;
