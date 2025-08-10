const getTopHolderStats = require("../safetyCheckers/getTopHolderStats");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

(async () => {
  try {
    const mint = process.argv[2];
    if (!mint) {
      console.error("❌ Please provide a token mint address.");
      process.exit(1);
    }

    const result = await getTopHolderStats(mint);

    console.log("✅ Top Holder Stats:");
    console.log(JSON.stringify(result, null, 2));

    if (result.isDominant) {
      console.warn("⚠️ Top holder owns more than 50% of supply!");
    } else if (result.topHolderPct > 30) {
      console.warn("⚠️ Top holder owns a significant portion (>30%)");
    } else {
      console.log("🟢 Holder distribution looks okay");
    }

  } catch (err) {
    console.error("❌ Error:", err.message || err);
  }
})();
