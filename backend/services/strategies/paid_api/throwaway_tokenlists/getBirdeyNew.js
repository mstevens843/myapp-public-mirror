// 3. 🆕 getBirdeyeNew.js
// Sort by: createdAt
// Use case: fresh new launches
// Filters: liquidity > 100, price > 0.001, no stables
require("dotenv").config({ path: __dirname + "/../../../../.env" });
const CU_TABLE = require("../cuTable");
const { birdeyeCUCounter } = require("../birdeyeCUCounter");

const URL = "https://public-api.birdeye.so/defi/tokenlist";

async function getBirdeyeNew(userId, limit = 20, minLiquidity = 100) {
  const res = await birdeyeCUCounter({
    url: URL,
    params: {
      sort_by: "createdAt",
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

module.exports = getBirdeyeNew;