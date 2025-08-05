require("dotenv").config({ path: __dirname + "/../../../../.env" });
const getTokenVolumeJupiter = require("../getTokenVolumeJupiter");

const TEST_MINTS = [
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ", // DUST
];

(async () => {
  for (const mint of TEST_MINTS) {
    const vol = await getTokenVolumeJupiter(mint);
    console.log(`📊 24h Volume for ${mint.slice(0, 6)}...: $${vol.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  }
})();
