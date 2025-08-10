// backend/tests/safetyChecks/testIsSafeToBuy.js
const { isSafeToBuyDetailed } = require("../safetyChecks");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address.");
  process.exit(1);
}

(async () => {
  const result = await isSafeToBuyDetailed(mint);
  console.dir(result, { depth: null });
})();
