require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const getHolderCount = require("../uiSafetyStatUtils/getHolderCount");

(async () => {
  try {
    const mint = process.argv[2];
    if (!mint) {
      console.error("❌ Please provide a token mint address.");
      process.exit(1);
    }

    const { holderCount } = await getHolderCount(mint);
    console.log(`🧮 Unique holders: ${holderCount.toLocaleString()}`);
  } catch (err) {
    console.error("❌ Error:", err.message || err);
  }
})();
