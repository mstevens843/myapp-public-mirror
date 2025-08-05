const getTokenPriceChangeJupiter = require("../getTokenPriceChangeJupiter");

const mints = [
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ"  // DUST
];

(async () => {
  for (const mint of mints) {
    const { change1h, change24h } = await getTokenPriceChangeJupiter(mint);
    console.log(`📉 ${mint.slice(0, 6)}... → 1h: ${(change1h * 100).toFixed(2)}%, 24h: ${(change24h * 100).toFixed(2)}%`);
  }
})();
