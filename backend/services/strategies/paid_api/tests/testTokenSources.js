/**
 * testTokenSources.js
 * ─────────────────────────────────────────
 * Runs all 3 token-fetching utilities:
 *   - Trending Tokens
 *   - Fresh Token List (by volume + liquidity)
 *   - New Listings
 * Outputs a quick sample from each.
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });

const getTrendingTokensList = require("../getTrendingTokensList");
const getFreshTokenList    = require("../getFreshTokenList");
const getNewListings       = require("../getNewListings");

async function testTokenSources() {
  console.log("🔍 Testing Birdeye token sources...\n");

  // Trending tokens
  const trending = await getTrendingTokensList(10);
  console.log(`✅ Trending Tokens (${trending.length}):`);
  console.log(trending.slice(0, 3), "\n");

  // Fresh tokens by 24h volume + min liquidity
  const fresh = await getFreshTokenList(10, 1000);
  console.log(`✅ Fresh Tokens by Volume (${fresh.length}):`);
  console.log(fresh.slice(0, 3), "\n");

  // New Listings
  const newListings = await getNewListings(10, true);
  console.log(`✅ New Listings (${newListings.length}):`);
  console.log(newListings.slice(0, 3), "\n");
}

testTokenSources().catch((err) => {
  console.error("❌ Test run failed:", err.message);
});
