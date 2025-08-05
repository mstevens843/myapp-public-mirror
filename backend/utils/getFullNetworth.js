// getFullNetWorth.js
const { PublicKey } = require("@solana/web3.js"); 
const { getTokenAccountsAndInfo } = require("./tokenAccounts");
// const { getTokenPriceApp } = require("./marketData");  // 🧠 instead of priceCache
const { getWalletBalance }        = require("../services/utils/wallet/walletManager");
const { getCachedPrice } = require("./priceCache.dynamic");
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const getTokenPrice = require("../services/strategies/paid_api/getTokenPrice");
const getSolPrice = getTokenPrice.getSolPrice;/** ⚙️  Used by server-side jobs / bots (no UI-specific tweaks) */
async function getFullNetWorth(pubkeyInput, userId = null) {
  const owner = (pubkeyInput instanceof PublicKey)
    ? pubkeyInput
    : new PublicKey(pubkeyInput?.publicKey ?? pubkeyInput);

  const tokens     = await getTokenAccountsAndInfo(owner);
  const solBalance = await getWalletBalance(owner);

  // ONE price fetch for SOL (cached)
  const solPrice   = await getSolPrice(userId); // ⬅️ Direct call
  const solValue = solBalance * solPrice;

  let total       = solValue;
  const tokenVals = [{
    name     : "SOL",
    mint     : SOL_MINT,
    amount   : solBalance,
    price    : solPrice,
    valueUSD : +solValue.toFixed(2),
  }];

  for (const t of tokens) {
    // skip SOL / USDC duplicates already handled
    if (t.mint === SOL_MINT || t.mint === USDC_MINT) continue;

    const price = await getTokenPrice(userId, t.mint);
    const value = price ? t.amount * price : 0;
    total += value;

    tokenVals.push({ ...t, price, valueUSD: +value.toFixed(2) });
  }

  return { totalValueUSD: +total.toFixed(2), tokenValues: tokenVals };
}

/* -------------------------------------------------------------------------- */
/** ⚙️  Used by WalletBalancePanel & Telegram (UI-friendly: USDC fixed @ 1) */
async function getFullNetWorthApp(pubkeyInput, userId = null) {
  /* Accepts: PublicKey | base-58 string | { publicKey } */
  const owner = (pubkeyInput instanceof PublicKey)
    ? pubkeyInput
    : new PublicKey(pubkeyInput?.publicKey ?? pubkeyInput);

  console.log("📊 getFullNetWorthApp called for:", owner.toBase58());

  const tokens     = await getTokenAccountsAndInfo(owner);
  console.log("📦 tokens fetched:", tokens);

  const solBalance = await getWalletBalance(owner);
  console.log("💰 SOL balance:", solBalance);

  const solPrice   = await getSolPrice(userId);
  console.log("💵 SOL price:", solPrice);

  const solValue = solBalance * solPrice;

  let total       = solValue;
  const tokenVals = [{
    name     : "SOL",
    mint     : SOL_MINT,
    amount   : solBalance,
    price    : solPrice,
    valueUSD : +solValue.toFixed(2),
  }];

  for (const t of tokens) {
    console.log("🔎 Checking token:", t.mint);
  const price = (t.mint === USDC_MINT)
    ? 1.0
    : await getTokenPrice(userId, t.mint);

    console.log("➡ price:", price);

    const value = price ? t.amount * price : 0;
    total += value;

    tokenVals.push({ ...t, price, valueUSD: +value.toFixed(2) });
  }

  console.log("✅ Total networth:", total);

  return { totalValueUSD: +total.toFixed(2), tokenValues: tokenVals };
}

module.exports = { getFullNetWorth, getFullNetWorthApp };
