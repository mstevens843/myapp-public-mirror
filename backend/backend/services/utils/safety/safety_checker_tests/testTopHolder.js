// services/safety/tests/testBirdeyeTopHolder.js
const { checkBirdeyeTopHolderRisk } = require("../birdeyeTopHolderCheck");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a token mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkBirdeyeTopHolderRisk(mint);
  if (result.passed) {
    console.log(`✅ Passed: Top holder owns ${result.topHolderPct}`);
  } else {
    console.warn(`⚠️ Failed: ${result.error}`);
  }
})();