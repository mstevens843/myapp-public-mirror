require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const getTokenAgePrecise = require("../uiSafetyStatUtils/TokenAgeChecker");

(async () => {
  try {
    const mint = process.argv[2];
    if (!mint) {
      console.error("❌  Please provide a token mint address.");
      process.exit(1);
    }

    const age = await getTokenAgePrecise(mint);
    console.log("📅  Token age (precise / archive):");
    console.log(JSON.stringify(age, null, 2));
  } catch (err) {
    console.error("❌  Error:", err.message || err);
  }
})();