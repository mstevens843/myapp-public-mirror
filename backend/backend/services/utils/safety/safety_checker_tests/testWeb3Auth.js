// test/testWeb3Authority.js

const { checkWeb3Authorities } = require("../web3AuthCheck");

const mint = process.argv[2];
if (!mint) {
  console.error("❌ Please provide a token mint address.");
  process.exit(1);
}

(async () => {
  const result = await checkWeb3Authorities(mint);
  console.log("✅ Web3 Authority Check Result:");
  console.log(JSON.stringify(result, null, 2));
})();
