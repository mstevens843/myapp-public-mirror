// backend/tests/safetyChecks/testJupiterSim.js
const { simulateAndCheckSwap } = require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const result = await simulateAndCheckSwap(mint);
  console.log("✅ Jupiter Simulation Result:", result);
})();
