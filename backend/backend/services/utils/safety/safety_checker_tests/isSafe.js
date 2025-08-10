// test/safetyChecks.test.js
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { isSafeToBuy, isSafeToBuyDetailed } = require(
  "../safetyCheckers/botIsSafeToBuy"
);

// 👇 test mint (you can swap to any real token)
const mint = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

(async () => {
  console.log("------ isSafeToBuyDetailed (all checks ON) ------");
  const detailed = await isSafeToBuyDetailed(mint, {
    simulation: true,
    liquidity: true,
    authority: true,
    topHolders: true,
    verified: true,
  });
  console.log(JSON.stringify(detailed, null, 2));

  console.log("\n------ isSafeToBuy (should return true/false) ------");
  const simple = await isSafeToBuy(mint, {
    safetyEnabled: true,
    safetyChecks: {
      simulation: true,
      liquidity: true,
      authority: true,
      topHolders: true,
      verified: true,
    },
  });
  console.log("Passed:", simple);
})();
