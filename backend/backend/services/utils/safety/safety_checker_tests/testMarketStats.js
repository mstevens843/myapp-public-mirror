// testMarketStats.js  ── run with:  node testMarketStats.js 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr

const path = require("path");

// 👉 adjust the relative path below to where *getTokenMarketStats.js* lives
const getTokenMarketStats = require("../uiSafetyStatUtils/getTokenMarketStats"); 
const mint = process.argv[2];

if (!mint) {
  console.error("❌  Usage:  node testMarketStats.js <mint>");
  process.exit(1);
}

(async () => {
  console.log(`⏳  Fetching market stats for ${mint} …`);

  const stats = await getTokenMarketStats(mint);

  if (!stats) {
    console.error("💥  getTokenMarketStats returned null (rate-limit or other error).");
    process.exit(1);
  }

  console.log(`
📈  Birdeye Market Stats
────────────────────────────────────────
 Price ........ $${stats.price}
 24h Δ ........ ${stats.change24h} %
 Liquidity .... $${stats.liquidity.toLocaleString()}
 Volume (24h).. ${stats.volume24h ? "$" + stats.volume24h.toLocaleString() : "—"}
`);
})();
  