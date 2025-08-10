// services/utils/safety_checker_tests/testBirdeyeVerified.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const { checkBirdeyeVerified } = require("../safetyCheckers/birdeyeVerifiedCheck");

(async () => {
  try {
    const mint = process.argv[2];
    if (!mint) {
      console.error("❌ Please provide a token mint address.");
      process.exit(1);
    }

    const result = await checkBirdeyeVerified(mint);
    console.log("✅ Birdeye Verified Check Result:");
    console.log(JSON.stringify(result, null, 2));

    if (result.passed) {
      console.log(`🟢 ${result.symbol || "Token"} is on Birdeye verified list`);
    } else {
      console.warn(`⚠️ ${result.error}`);
    }
  } catch (err) {
    console.error("❌ Error:", err.message || err);
  }
})();
