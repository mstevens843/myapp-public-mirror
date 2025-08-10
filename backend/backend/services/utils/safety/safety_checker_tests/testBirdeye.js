require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const { checkBirdeyeLiquidity } = require("../safetyCheckers/birdeyeLiquidityCheck");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a mint address as an argument.");
  process.exit(1);
}

(async () => {
  try {
    const result = await checkBirdeyeLiquidity(mint);
const liquidity = result.data?.liquidity;

if (result.passed && liquidity !== undefined) {
  console.log(`✅ Passed: Liquidity is $${liquidity.toLocaleString()}`);
} else if (liquidity === undefined) {
  console.warn(`⚫ Skipped: ${result.reason} — ${result.detail}`);
} else {
  console.warn(`❌ Failed: ${result.reason} — ${result.detail}`);
}
  } catch (err) {
    console.error("💥 Unexpected error during test:", err.message);
  }
})();
