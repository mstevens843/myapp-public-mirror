// test/testHeliusAuthority.js

const { checkHeliusAuthorities } = require("../heliusMintAuthCheck");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a token mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkHeliusAuthorities(mint);
  console.log("✅ Helius Authority Check Result:");
  console.log(JSON.stringify(result, null, 2));
})();
