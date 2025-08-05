/** getTopGainers.js
 * Sort by: priceChange1h
 *  Use case: catch explosive runners
* Filters: liquidity > 1000, price > 0.001, no stablecoins
 *  */ 
require("dotenv").config({ path: __dirname + "/../../../../.env" });

const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/tokenlist";

async function getTopGainers(userId, limit = 20, minLiquidity = 1000) {
  const res = await birdeyeCUCounter({
    url: URL,
    params: {
      sort_by: "priceChange1h",
      sort_type: "desc",
      limit,
      min_liquidity: minLiquidity,
      offset: 0,
    },
    cuCost: CU_TABLE["/defi/tokenlist"],
    userId,
  });

  const tokens = res?.data?.tokens || [];
  return tokens.filter(t => t.price > 0.001);
}

module.exports = getTopGainers;

