/**
 * getTokenOverviewTest.js
 * ---------------------------------
 * Run with: `node tests/getTokenOverviewTest.js`
 * Purpose: Show short-term price % moves and volume USD for a token
 */

const getTokenOverview = require("../getTokenShortTermChanges");

const TEST_MINT = process.argv[2] || "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump"; // Default to SOL
// "So11111111111111111111111111111111111111112"
// Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump
(async () => {
const result = await getTokenOverview(null, TEST_MINT, "5m", "1h");

  console.log(`\n✅ Token Overview for ${TEST_MINT}:`);
  console.log(`Price:       $${result.price}`);
  console.log(`Market Cap:  $${result.marketCap.toLocaleString()}`);

  console.log(`\n📉 Price Change (%):`);
  if (result.priceChange1m != null)   console.log(`   1m: ${(result.priceChange1m * 100).toFixed(2)}%`);
  if (result.priceChange5m != null)   console.log(`   5m: ${(result.priceChange5m * 100).toFixed(2)}%`);
  if (result.priceChange15m != null)  console.log(`  15m: ${(result.priceChange15m * 100).toFixed(2)}%`);
  if (result.priceChange30m != null)  console.log(`  30m: ${(result.priceChange30m * 100).toFixed(2)}%`);
  if (result.priceChange1h != null)   console.log(`   1h: ${(result.priceChange1h * 100).toFixed(2)}%`);
  if (result.priceChange2h != null)   console.log(`   2h: ${(result.priceChange2h * 100).toFixed(2)}%`);
  if (result.priceChange4h != null)   console.log(`   4h: ${(result.priceChange4h * 100).toFixed(2)}%`);
  if (result.priceChange6h != null)   console.log(`   6h: ${(result.priceChange6h * 100).toFixed(2)}%`);
  if (result.priceChange8h != null)   console.log(`   8h: ${(result.priceChange8h * 100).toFixed(2)}%`);
  if (result.priceChange12h != null)  console.log(`  12h: ${(result.priceChange12h * 100).toFixed(2)}%`);
  if (result.priceChange24h != null)  console.log(`  24h: ${(result.priceChange24h * 100).toFixed(2)}%`);

  console.log(`\n💵 Volume USD:`);
  if (result.volume1m != null)   console.log(`   1m: $${result.volume1m.toLocaleString()}`);
  if (result.volume5m != null)   console.log(`   5m: $${result.volume5m.toLocaleString()}`);
  if (result.volume30m != null)  console.log(`  30m: $${result.volume30m.toLocaleString()}`);
  if (result.volume1h != null)   console.log(`   1h: $${result.volume1h.toLocaleString()}`);
  if (result.volume2h != null)   console.log(`   2h: $${result.volume2h.toLocaleString()}`);
  if (result.volume4h != null)   console.log(`   4h: $${result.volume4h.toLocaleString()}`);
  if (result.volume8h != null)   console.log(`   8h: $${result.volume8h.toLocaleString()}`);
  if (result.volume24h != null)  console.log(`  24h: $${result.volume24h.toLocaleString()}`);

  console.log(); // newline
})();