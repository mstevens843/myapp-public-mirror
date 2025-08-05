require("dotenv").config({ path: __dirname + "/../../../.env" });
const wm = require("../../core/walletManager");
const getWalletTokensWithMeta = require("../getWalletTokensWithMeta");

(async () => {
  wm.initWallets(["default"]);
  const wallet = wm.current().publicKey.toBase58();
  console.log("👛 Wallet:", wallet);

  const tokens = await getWalletTokensWithMeta(wallet);
  console.log("\n📊 Tokens in Wallet:");
  for (const t of tokens) {
    console.log(`• ${t.mint} → ${t.name}${t.symbol ? ` (${t.symbol})` : ""} (${t.amount})`);
  }
})();
