// backend/tests/safetyChecks/testDevHolding.js
const { checkPumpFunSafety, checkDevHolding, getTopHolderBalances } = require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const pump = await checkPumpFunSafety(mint);
  const devAddress = pump?.devAddress;
  if (!devAddress) {
    console.error("❌ No dev address found.");
    return;
  }

  const [top, devHeld] = await Promise.all([
    getTopHolderBalances(mint),
    checkDevHolding(mint, devAddress),
  ]);

  const total = top.reduce((sum, h) => sum + parseFloat(h.BalanceUpdate.Holding), 0);
  const dominance = devHeld / total;

  console.log(`✅ Dev Holding: ${devHeld} / ${total} = ${(dominance * 100).toFixed(2)}%`);
})();
