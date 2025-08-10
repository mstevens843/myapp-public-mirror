// safety_checker_tests/testSafeToBuy.js
const { isSafeToBuy, isSafeToBuyDetailed } = require("../safetyCheckers/isSafeToBuy");

// 🚀 Replace with any mint you want to test:
const TEST_MINT = process.argv[2]; // allow CLI override
const mint = TEST_MINT || "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"; // some new token

(async () => {
  console.log(`🔍 Checking safety for: ${mint}\n`);

  // Full breakdown
  const result = await isSafeToBuyDetailed(mint);
  console.log("🧪 Full Breakdown:\n", JSON.stringify(result, null, 2));

  // Simple boolean test
  const passed = await isSafeToBuy(mint, {
    safetyEnabled: true,
    safetyChecks: {
      simulation: true,
      liquidity: true,
      authority: true,
      verified: true,
      topHolders: true,
    },
  });

  console.log(`\n✅ isSafeToBuy() result:`, passed ? "✅ PASS" : "⛔ FAIL");
})();
