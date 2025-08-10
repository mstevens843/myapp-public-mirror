// backend/tests/safetyChecks/testSolanaFM.js
const { checkSolanaFMSafety } = require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkSolanaFMSafety(mint);
  console.log("✅ SolanaFM Check Result:", result);
})();
