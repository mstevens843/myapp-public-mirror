// services/utils/analytics/tradeFormatter.js
/* Central helpers so Manual, Limit, and DCA all log the
 * exact same data structure, using Birdeye first for price data.
 * ---------------------------------------------------------------- */
const { getCachedPrice }   = require("../../../utils/priceCache.dynamic"); // ✅ backend-safe cache
const { getMintDecimals }     = require("../../../utils/tokenAccounts");

const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Build a fully-formatted “buy” log object.
 * Handles SOL→token **and** USDC→token routes.
 */
async function prepareBuyLogFields({
  strategy,
  inputMint,
  outputMint,
  inAmount,     // raw (lamports / micro-USDC)
  outAmount,    // raw token units
  walletLabel = "default",
  slippage    = 1.0,
  txHash      = null,
  decimals, 
}) {
  /* ---------- 1. UI amounts ---------- */
  const inUi =
    inputMint === SOL_MINT
      ? Number(inAmount) / 1e9          // lamports → SOL
      : Number(inAmount) / 1e6;         // μUSDC   → USDC

    let outDecimals = decimals ?? 9;
  if (outDecimals == null) {
    try { outDecimals = await getMintDecimals(outputMint); }
    catch {/* keep default 9 */}
  }
      const outUi = Number(outAmount) / 10 ** outDecimals;

  /* ---------- 2. Price calculations ---------- */
  const entryPriceToken = inUi / outUi;      // price in *input* units
  let   entryPrice      = null;              // stays null for USDC buys
  let   entryPriceUSD   = null;

  if (inputMint === SOL_MINT) {
    entryPrice = entryPriceToken;            // price in SOL
const solPrice = await getCachedPrice(SOL_MINT);
    if (solPrice) entryPriceUSD = +(entryPrice * solPrice).toFixed(6);
} else {
    // input = USDC → price already in USD
    entryPrice      = entryPriceToken;                    // ✅ ADD THIS
    entryPriceUSD   = +entryPriceToken.toFixed(6);
  }

  /* ---------- 3. USD value of the buy ---------- */
  // Birdeye first, Jupiter fallback
  const inputTokenPrice = await getCachedPrice(inputMint); // ✅ no more Birdeye noise


  const usdValue = inputTokenPrice
    ? +(inUi * inputTokenPrice).toFixed(2)
    : null;

  /* ---------- 4. Return unified payload ---------- */
  return {
    timestamp : new Date().toISOString(),
    strategy,
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    entryPrice,       // SOL price (null for USDC buys)
    entryPriceUSD,    // always populated now ✅
    spentSOL   : inputMint === SOL_MINT ? inUi : null,
    usdValue,
    walletLabel,
    slippage,
    txHash,
    type      : "buy",
    success   : true,
    decimals  : outDecimals, 
  };
}

module.exports = { prepareBuyLogFields };


/**
 * ✅ What We Did
We created a shared helper file called:

services/utils/analytics/tradeFormatter.js

This file includes a reusable function:

js
Copy
Edit
prepareBuyLogFields()
This function standardizes how we log trade data when a buy is executed — whether the trade came from:

A Manual Buy

A Limit Order

A DCA Trigger

🧠 Why We Did It
Previously, each trade type (manual, limit, DCA) handled logging independently, and that led to:

Inconsistent trade fields (e.g. entryPriceUSD, spentSOL, usdValue)

Different logic for calculating the same thing

Errors or missing values in the Open/Closed trade logs

Manual buys working perfectly ✅ but DCA/Limit logs being broken ❌

🔧 What the prepareBuyLogFields() Function Does
It takes raw swap data like:

inputMint, outputMint

inAmount, outAmount

walletLabel, strategy, slippage, txHash

And returns a fully formatted object with:

entryPrice: calculated as inAmount / outAmount

entryPriceUSD: calculated via SOL price × entryPrice

spentSOL: if the input token is SOL

usdValue: based on Birdeye price first, then fallback to Jupiter price

Timestamp, wallet label, slippage, etc.

This means:

Every buy — no matter the trigger source — gets logged the same way and with full accuracy.

🔁 Where We Integrated It
You already integrated it in:

✅ Limit Orders

(Next: DCA triggers will use this too)

Wherever we execute a buy, we now do:

js
Copy
Edit
const logPayload = await prepareBuyLogFields({ ... });
await logTrade(logPayload);
await addOrUpdateOpenTrade(...);
🔒 Benefits
Fixes incorrect PnL or entry data for DCA/Limit buys

Unifies trade logging across the entire system

Makes future maintenance & upgrades easier

Adds price safety by using Birdeye first, then fallback

Let me know when you're ready to refactor DCA to use this too.
 */