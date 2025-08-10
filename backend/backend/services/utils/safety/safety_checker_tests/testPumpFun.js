// backend/tests/safetyChecks/testPumpFun.js
const { checkPumpFunSafety } = require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkPumpFunSafety(mint);
  console.log("✅ Pump.fun Check Result:", result);
})();
