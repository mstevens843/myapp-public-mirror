const path          = require("path");
const getTokenPrice = require("./getTokenPrice");   // adjust path if needed
const { SOL_MINT }  = require("./getTokenPrice");

(async () => {
  const mint = process.argv[2] || SOL_MINT;

  try {
    const price = await getTokenPrice(mint);
    console.log(`${mint} → $${price}`);
  } catch (err) {
    console.error("❌ Failed to fetch price:", err.message);
    process.exit(1);
  }
})();