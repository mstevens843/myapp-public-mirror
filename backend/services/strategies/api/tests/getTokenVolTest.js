require("dotenv").config({ path: __dirname + "/../../../../.env" });
const getTokenVolume = require("../getTokenVolume");

const TEST_MINT = "So11111111111111111111111111111111111111112"; // SOL

(async () => {
  const vol = await getTokenVolume(TEST_MINT);
  console.log(`📊 24h volume for SOL: $${vol.toLocaleString()}`);
})();
