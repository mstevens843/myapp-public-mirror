// backend/tests/safetyChecks/testSolscanVerified.js
const { checkSolscanVerified }= require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkSolscanVerified(mint);
  console.log("✅ Solscan Verified Check Result:", result);
})();
