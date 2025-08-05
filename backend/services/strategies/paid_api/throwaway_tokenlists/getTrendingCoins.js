// 2. getTrendingTokens.js
// Sort by: v24hUSD
// Use case: whales & high-volume movers
// Filters: liquidity > 1000, price > 0.001, no stablecoins

// new one manipulating the overview
require("dotenv").config({ path: __dirname + "/../../../../.env" });
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/tokenlist";

let cache = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getTrendingTokens(userId, limit = 20, minLiquidity = 1000) {
  const now = Date.now();
  if (cache.length && now - lastFetch < CACHE_TTL) {
    return cache;
  }

  const res = await birdeyeCUCounter({
    url: URL,
    params: {
      sort_by: "v24hUSD",
      sort_type: "desc",
      limit,
      min_liquidity: minLiquidity,
      offset: 0,
    },
    cuCost: CU_TABLE["/defi/tokenlist"],
    userId,
  });

  const tokens = res?.data?.tokens || [];
  cache = tokens.filter(t => t.price > 0.001);
  lastFetch = now;
  return cache;
}

module.exports = getTrendingTokens;
