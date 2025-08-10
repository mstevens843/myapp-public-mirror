const getTrendingTokensList = require("../getTrendingTokensList");

(async () => {
  const trending = await getTrendingTokensList(10);
  console.log(`🔥 Top trending tokens:`);
  trending.slice(0, 5).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol} – ${t.volume24hUSD?.toLocaleString()} USD`);
  });
})();