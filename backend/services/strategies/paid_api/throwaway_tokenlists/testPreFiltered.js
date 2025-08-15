// testTokenLists.js
const getTrending = require("../Token_Lists/getTrendingTokensList");
const getGainers = require("./getTopGainers");
const getNew = require("./getBirdeyNew");

(async () => {
  const userId = "test-user"; // any string for CU tracking

  console.log("🔹 Trending:");
  const trending = await getTrending(userId);
  console.log(trending.map(t => t.symbol || t.address));

  console.log("\n🔹 Gainers:");
  const gainers = await getGainers(userId);
  console.log(gainers.map(t => t.symbol || t.address));

  console.log("\n🔹 Birdeye New:");
  const fresh = await getNew(userId);
  console.log(fresh.map(t => t.symbol || t.address));
})();


