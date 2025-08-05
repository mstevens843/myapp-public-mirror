const { getTokenAccountsAndInfo } = require("../../../utils/tokenAccounts");
const { PublicKey } = require("@solana/web3.js");
const { getCurrentWallet } = require("../wallet/walletManager");


let cachedTokens = null;
let triedLoading = false;

async function getTokenName(mint) {
  // ❌ Give up if we've tried before and failed
  if (triedLoading && !cachedTokens) return "Unknown";

  // 🧠 Lazy-load once
  if (!cachedTokens) {
    triedLoading = true;

    try {
      const wallet = getCurrentWallet();
      const tokens = await getTokenAccountsAndInfo(wallet.publicKey);

      cachedTokens = {};
      for (const t of tokens) cachedTokens[t.mint] = t.name;
      console.log("✅ Token names cached:", Object.keys(cachedTokens).length);
    } catch (err) {
      console.error("❌ Failed loading tokens:", err.message);
      cachedTokens = {}; // don't retry
    }
  }

  return cachedTokens[mint] || "Unknown";
}

module.exports = { getTokenName }