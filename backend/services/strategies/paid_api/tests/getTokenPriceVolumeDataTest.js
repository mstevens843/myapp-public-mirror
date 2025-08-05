/**
 * getPriceVolumeDataTest.js
 * ---------------------------------
 * Run: `node tests/getPriceVolumeDataTest.js`
 */

const getPriceVolumeData = require("../getPriceVolumeData");

const TEST_MINT = "So11111111111111111111111111111111111111112"; // SOL

async function runTest() {
  const data = await getPriceVolumeData(TEST_MINT);

  console.log("✅ Fetched Data:");
  console.log(`Price:               $${data.price.toFixed(4)}`);
  console.log(`24h Volume (USD):    $${data.volumeUSD.toLocaleString()}`);
  console.log(`Price Change %:      ${(data.priceChangePercent * 100).toFixed(2)}%`);
  console.log(`Volume Change %:     ${(data.volumeChangePercent * 100).toFixed(2)}%`);
}

runTest();
