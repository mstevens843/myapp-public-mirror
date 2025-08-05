// test_getTokenPrice.js
require("dotenv").config({ path: __dirname + "/../../../../.env" });
const getTokenPrice = require("../getTokenPrice");

const TEST_MINTS = [
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ"  // real SPL token (DUST)
];

(async () => {
  for (const mint of TEST_MINTS) {
    const price = await getTokenPrice(req.user.id, mint);
    console.log(`💰 ${mint.slice(0, 6)}... → $${price.toFixed(4)}`);
  }
})();