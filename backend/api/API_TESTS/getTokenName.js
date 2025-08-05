const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { PublicKey } = require("@solana/web3.js");

const mintArg = process.argv[2];
if (!mintArg) {
  console.error("❌ Provide a mint address: node getTokenName.js <mint>");
  process.exit(1);
}

const WALLET = new PublicKey("7vigaj5e6uaudbyDj1n1kWkEWjHq5nNaUASh72bzzkNm");

(async () => {
  try {
    const tokens = await getTokenAccountsAndInfo(WALLET);
    const match = tokens.find(t => t.mint === mintArg);
    if (!match) return console.log("⚠️ Token not found.");
    console.log(`✅ ${match.name} (${match.mint})`);
  } catch (err) {
    console.error("❌ Failed:", err);
  }
})();
