// test/testHybridAuthority.js

const { checkMintAuthoritiesHybrid } = require("../safetyCheckers/hybridAuthCheck");

const mint = process.argv[2];
const forceWeb3 = process.argv[3] === "true";

if (!mint) {
  console.error("❌ Please provide a token mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkMintAuthoritiesHybrid(mint, forceWeb3);
  console.log("✅ Hybrid Authority Check Result (Source:", result.source, ")");
  console.log(JSON.stringify(result, null, 2));
})();
