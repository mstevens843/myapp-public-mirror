/**
 * getTokenPriceChangeTest.js
 * ---------------------------------
 * Run: `node tests/getTokenPriceChangeTest.js`
 */

const getTokenPriceChange = require("../getTokenPriceChange");

// Example token
const TEST_MINT = "So11111111111111111111111111111111111111112"; // SOL

async function runTest() {
  const oneHour = await getTokenPriceChange(TEST_MINT, 1);
  console.log(`✅ 1h % change for ${TEST_MINT}: ${oneHour.toFixed(4)}%`);

  const twentyFourHour = await getTokenPriceChange(TEST_MINT, 24);
  console.log(`✅ 24h % change for ${TEST_MINT}: ${twentyFourHour.toFixed(4)}%`);
}

runTest();
