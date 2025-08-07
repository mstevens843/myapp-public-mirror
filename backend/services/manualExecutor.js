require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { v4: uuid } = require("uuid");
const { getSwapQuote, executeSwap } = require("../utils/swap");
const { getTokenBalance, getTokenPrice, getTokenPriceApp, getTokenBalanceRaw } = require("../utils/marketData");
const { PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const { logTrade } = require("./utils/analytics/logTrade");
const { sendAlert } = require('../telegram/alerts.js'); // ✅ the unified new one
const axios = require("axios"); // ✅ ADD
const { getMintDecimals } = require("../utils/tokenAccounts.js");
// const { getUserPreferences } = require("../telegram/services/userPrefs");
const { addOrUpdateOpenTrade } = require("./utils/analytics/openTrades");
const prisma = require("../prisma/prisma");           // NEW
const { Keypair }                      = require("@solana/web3.js");
const bs58                             = require("bs58");
const { decrypt }                      = require("../middleware/auth/encryption");
const { getUserPreferencesByUserId } = require("./userPrefs"); 
const SOL_MINT = "So11111111111111111111111111111111111111112";
const API_BASE = process.env.API_BASE; 
const { getDEK } = require("../armEncryption/sessionKeyCache");
const { decryptPrivateKeyWithDEK } = require("../armEncryption/envelopeCrypto");
// ------------------------------------------------------------------
// restore missing log-file constant (dashboard still reads this file)
const { closePositionFIFO } = require("./utils/analytics/fifoReducer")

//   } catch { /* silent fail */ }
// }


async function alertUser(userId, msg, tag = "Buy") {
  try {
    await sendAlert(userId, msg, tag);  // will handle prefs + chatId
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}


function shortMint(m) {
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}



function tsUTC() {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmt(x, d = 4) {
  return (+x).toFixed(d).replace(/\.?0+$/, "");
}


// async function loadWalletKeypair(walletId) {
//   const row = await prisma.wallet.findUnique({
//     where  : { id: walletId },
//     select : { privateKey: true }
//   });
//   if (!row) throw new Error("Wallet not found in DB.");

//   const secret = decrypt(row.privateKey);        // <- your AES helper
//   const kp     = Keypair.fromSecretKey(bs58.decode(secret.trim()));
//   return kp;
// }
// REPLACE with Arm-aware loader (envelope + in-memory DEK; legacy fallback)
async function loadWalletKeypairArmAware(userId, walletId) {
  const row = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { encrypted: true, isProtected: true, privateKey: true },
  });
  if (!row) throw new Error("Wallet not found in DB.");

  const aad = `user:${userId}:wallet:${walletId}`; // DO compute AAD from context

  // Envelope path (preferred)
  if (row.encrypted && row.encrypted.v === 1) {
    const dek = getDEK(userId, walletId);
    if (!dek) {
      const err = new Error("Automation not armed");
      err.status = 401;               // let API layer map to 401
      err.code = "AUTOMATION_NOT_ARMED";
      throw err;
    }
    const pkBuf = decryptPrivateKeyWithDEK(row.encrypted, dek, aad);
    try {
      return Keypair.fromSecretKey(new Uint8Array(pkBuf));
    } finally { pkBuf.fill(0); }
  }

  // Legacy fallback (string -> base58)
  if (row.privateKey) {
    // IMPORTANT: pass AAD here too
    const secret = decrypt(row.privateKey, { aad });
    return Keypair.fromSecretKey(bs58.decode(secret.trim()));
  }

  throw new Error("Wallet has no usable key material");
}

// let prefs = null;
// if (chatId) {
//   prefs = await getUserPreferences(chatId);
//   slippage = prefs.slippage ?? slippage;
// }


/**
 * Manually execute a buy from SOL → token
 */

async function performManualBuy(opts) {
  const {
    amountInSOL = null,
    amountInUSDC = null,
    mint,
    userId,
    walletId,
    walletLabel,
    chatId = null,
    slippage: slippageInput = 1.0,
    strategy = "manual",
    context = "default",
    skipLog = false,
    tp, sl, tpPercent, slPercent,
  } = opts;

  console.log("💾 performManualBuy received TP/SL:", { tp, sl, tpPercent, slPercent });

  /* ── wallet & prefs ────────────────────────────────────────────────────────── */
  let wallet;
  try {
    wallet = await loadWalletKeypairArmAware(userId, walletId);
  } catch (e) {
    if (e.status === 401 || e.code === "AUTOMATION_NOT_ARMED") { e.expose = true; throw e; }
    throw e;
  }  
const prefs  = await getUserPreferencesByUserId(userId, context);
  /* slippage: explicit > saved slippage > saved max‑slippage > fallback arg */
  const slippageToUse =
    prefs?.slippage ??
    prefs?.defaultMaxSlippage ??
    slippageInput;
  /* MEV / bribery / priority‑fee */
  const mevMode        = (prefs?.mevMode === "secure" ? "secure" : "fast");   // sanitise
  const briberyAmount  = prefs?.briberyAmount ?? 0;
  const priorityFeeToUse =
    prefs?.defaultPriorityFee !== undefined
      ? prefs.defaultPriorityFee
      : 0;
  const shared         = mevMode === "secure";
  console.log("🛡️ MEV settings:", { mevMode, shared, priorityFeeToUse, briberyAmount });

  /* ── wallet row ────────────────────────────────────────────────────────────── */
  const walletRow = await prisma.wallet.findUnique({
    where: { publicKey: wallet.publicKey.toBase58() },
    select: { id: true },
  });
  if (!walletRow) throw new Error("Wallet not in DB.");

  /* Prevent duplicate TP/SL on existing position */
  if (tp != null || sl != null) {
    const alreadyHolding = await prisma.trade.findFirst({
      where: {
        walletId: walletRow.id,
        mint,
        strategy,
        outAmount: { gt: 0 },
      },
    });
    if (alreadyHolding) {
      throw new Error(
        "🚫 Cannot set TP/SL on buy: you already hold this mint+strategy. Manage it in Open Trades.",
      );
    }
  }

  /* validate buy amount ------------------------------------------------------- */
  if (
    (!amountInSOL && !amountInUSDC) ||
    ((amountInSOL != null && +amountInSOL <= 0) &&
      (amountInUSDC != null && +amountInUSDC <= 0))
  ) {
    throw new Error("❌ No valid buy amount provided – must specify amountInSOL or amountInUSDC.");
  }

  /* build quote --------------------------------------------------------------- */
  const inputMint = amountInUSDC
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC
    : SOL_MINT;                                      // SOL

  const inAmount = amountInUSDC
    ? Math.floor(amountInUSDC * 1e6)   // USDC (6 dec)
    : Math.floor(amountInSOL * 1e9);   // SOL  (9 dec)

  console.log("⚙️ Applied user prefs for manual buy:", {
    slippageInput,
    slippageToUse,
    maxSlippage: prefs?.defaultMaxSlippage,
    priorityFeeToUse,
    mevMode,
    briberyAmount,
  });

  const slippageBps = Math.round(Number(slippageToUse) * 100);

  const quote = await getSwapQuote({
    inputMint,
    outputMint: mint,
    amount: inAmount,
    slippageBps,                              // always pass bps
  });
  if (!quote) throw new Error("❌ No route for manual buy");

  /* execute swap ------------------------------------------------------------- */
  let tx;
  try {
    tx = await executeSwap({
      quote,
      wallet,
      shared,                                 // MEV secure?
      priorityFee: priorityFeeToUse,          // µ‑lamports
      briberyAmount,                          // lamports
    });
  } catch (err) {
    const msg = err?.message || "";
    if (msg.includes("insufficient lamports") || msg.includes("custom program error: 0x1")) {
      throw new Error("Not enough SOL.");
    }
    if (msg.includes("Transfer: insufficient funds") || msg.toLowerCase().includes("usdc")) {
      throw new Error("Not enough USDC.");
    }
    throw new Error("Swap failed: " + msg);
  }
  if (!tx) throw new Error("❌ Swap transaction failed or returned null");

  /* price math ---------------------------------------------------------------- */
  const decimals       = await getMintDecimals(mint);
  const entryPriceSOL  = (Number(quote.inAmount) * 10 ** decimals) / (Number(quote.outAmount) * 1e9);
  const solPrice       = await getTokenPriceApp(SOL_MINT);
  const entryPriceUSD  = solPrice ? +(entryPriceSOL * solPrice).toFixed(6) : null;
  const tokenPrice     = await getTokenPriceApp(inputMint);
  const usdValue       = tokenPrice
    ? +((inAmount / 10 ** (inputMint === SOL_MINT ? 9 : 6)) * tokenPrice).toFixed(2)
    : null;

  /* analytics & DB ----------------------------------------------------------- */
  if (!skipLog) {
    /* 1️⃣ log file */
    logTrade({
      timestamp: new Date().toISOString(),
      strategy,
      inputMint: quote.inputMint,
      outputMint: mint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct * 100,
      txHash: tx,
      success: true,
      notes: "Manual Buy",
      usdValue,
      entryPrice: entryPriceSOL,
      entryPriceUSD,
      mevMode,
      briberyAmount,
      priorityFee: priorityFeeToUse,
      shared,
    });

    /* 2️⃣ trade row */
    await prisma.trade.create({
      data: {
        mint,
        tokenName: null,
        entryPrice: entryPriceSOL,
        entryPriceUSD,
        inAmount:  BigInt(quote.inAmount),
        outAmount: BigInt(quote.outAmount),
        closedOutAmount: BigInt(0),
        strategy,
        walletLabel,
        txHash: tx,
        unit: inputMint === SOL_MINT ? "sol" : "usdc",
        slippage: slippageToUse,
        decimals,
        usdValue,
        type: "buy",
        side: "buy",
        botId: strategy,
        walletId: walletRow.id,
        mevMode,
        priorityFee: priorityFeeToUse,
        briberyAmount,
        mevShared: shared,
      },
    });

    /* 3️⃣ optional TP/SL rule */
    if (tp != null || sl != null) {
      console.log("📝 Creating TP/SL rule with:", { tp, sl, tpPercent, slPercent });
      await prisma.tpSlRule.create({
        data: {
          id: uuid(),
          mint,
          walletId: walletRow.id,
          userId,
          strategy,
          tp, sl, tpPercent, slPercent,
          entryPrice: entryPriceSOL,
          force: false,
          enabled: true,
          status: "active",
          failCount: 0,
        },
      });
    }
  }
  /* alert -------------------------------------------------------------------- */
const explorer  = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
const tokenUrl  = `https://birdeye.so/token/${mint}`;
const short     = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
const time      = tsUTC();

const alertMsg = `
🛒 *${strategy} Buy Executed*

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *In:* ${ amountInSOL != null ? `${fmt(amountInSOL, 3)} SOL` : `${fmt(amountInUSDC, 2)} USDC`
  }  ≈ \`$${usdValue ?? "?"}\`
📈 *Entry:* \`$${entryPriceUSD ?? "N/A"}\`
🎯 *TP/SL:* \`${ tpPercent != null || slPercent != null
      ? `+${tpPercent ?? "N/A"} % / -${slPercent ?? "N/A"} %` : "N/A"}\`
👤 *Wallet:* \`${walletLabel}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();
await alertUser(userId, alertMsg, "Buy");
// await sendAlert(chatId || "ui", alertMsg, "Buy");
// await sendAlert(chatId || "ui", `🛒 *${strategy} Buy*\n[↗️ View](${explorer})`, "Buy");


  /* return payload ----------------------------------------------------------- */
  return {
    tx,
    mint,
    amountInSOL,
    amountInUSDC,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    entryPrice: entryPriceSOL,
    entryPriceUSD,
    priceImpact: quote.priceImpactPct,
    usdValue,
    message: "Buy complete",
  };
}




/**
 * Manually sell a % of token into SOL
 */
async function performManualSell(opts) {
  let {
    percent,
    mint,
    strategy      = "manual",
    chatId        = null,
    walletId,
    userId,
    walletLabel   = "default",
    slippage      = 0.5,
    context       = "default",
    triggerType,
  } = opts;

  /* 🔕  Skip duplicate “Sell” alert if TP/SL already sent one */
  const skipAlert = triggerType === "tp" || triggerType === "sl";

  /* ── Paper‑Trader short‑circuit ─────────────────── */
  /* ───────────── HELPERS & NORMALISATION ───────────── */
  const norm = (strategy || "").replace(/\s+/g, "").toLowerCase();
  const isPaperTrader = norm === "papertrader";

  /* ── Paper‑Trader short‑circuit ─────────────────── */
  if (isPaperTrader) {
    const dbWallet = await prisma.wallet.findUnique({
      where : { id: walletId },
      select: { id:true }
    });
    const rows = await prisma.trade.findMany({
      where:{
        walletId: dbWallet.id,
        mint,
        strategy:{ in:["Paper Trader","paperTrader"] },
        outAmount:{ gt:0 }
      },
      orderBy:{ timestamp:"asc" }
    });
    if (!rows.length) throw new Error("No paper‑trader rows for this mint.");

    /* same percent‑to‑raw logic as before */
    const totalRaw = rows.reduce((s,r)=>s+BigInt(r.outAmount),0n);
   if (percent > 1) percent /= 100;
    let sellRaw = (totalRaw * BigInt(Math.round(percent*1e6))) / 1_000_000n;
    if (sellRaw===0n) throw new Error("Too little balance.");

    /* get an exit price so we still show PnL */
    const decimals = rows[0].decimals ?? 9;
    const tokUsd   = await getTokenPriceApp(mint) ?? 0;
    const exitPriceUSD = tokUsd;
    const exitPrice    = tokUsd / (await getTokenPriceApp(SOL_MINT));
    await closePositionFIFO({
     userId,
     mint,
     walletId,
      walletLabel,
      percent,
      removedAmount : Number(sellRaw),  // just bookkeeping
      strategy      : rows[0].strategy ?? "Paper Trader",
      triggerType,
      exitPrice,
      exitPriceUSD,
      txHash        : "paper",          // sentinel
      slippage      : 0,
      slippageBps   : 0,
      decimals
    });

    return { message:`Closed ${(percent*100).toFixed(0)}% paper position` };
  }

  /* ── REAL sell continues below ──────────────────── */
  let wallet;
try {
  wallet = await loadWalletKeypairArmAware(userId, walletId);
} catch (e) {
  if (e.status === 401 || e.code === "AUTOMATION_NOT_ARMED") { e.expose = true; throw e; }
  throw e;
}
  const decimals = await getMintDecimals(mint);
  if (percent > 1) percent /= 100;

  const prefs = await getUserPreferencesByUserId(userId, context);
  const slippageToUse =
    prefs?.slippage ??
    prefs?.defaultMaxSlippage ??
    slippage;
  const mevMode        = prefs?.mevMode === "secure" ? "secure" : "fast";
  const briberyAmount  = prefs?.briberyAmount ?? 0;
  const priorityFeeToUse = prefs?.defaultPriorityFee ?? 0;
  const shared         = mevMode === "secure";

  console.log("⚙️ Applied user prefs for manual sell:", {
    slippageInput: slippage,
    slippageToUse,
    maxSlippage: prefs?.defaultMaxSlippage,
    priorityFee: priorityFeeToUse,
    mevMode,
    briberyAmount,
  });

  /* rows & sellRaw calc */
  const dbWallet = await prisma.wallet.findUnique({
    where : { publicKey: wallet.publicKey.toBase58() },
    select: { id: true }
  });
  if (!dbWallet) throw new Error("Wallet not in DB.");

const rowsAll = await prisma.trade.findMany({
  where: {
    walletId: dbWallet.id,    // PRIMARY FILTER
    mint,
    strategy: isPaperTrader ? { in:["Paper Trader","paperTrader"] } : strategy,
    ...(walletLabel && walletLabel !== "default" ? { walletLabel } : {})
  },
  orderBy: { timestamp: "asc" },
});

// Handle untracked (imported) tokens with missing entryPrice
let entryPrice = null;
let notes = null;
if (rowsAll.length === 1) {
  const trade = rowsAll[0];
  const isUntracked = trade.source === "imported" || trade.entryPrice === null;
  if (isUntracked) {
    notes = "Untracked token";
    entryPrice = null;
  }
}
  
 const rows = rowsAll.filter(r => BigInt(r.outAmount) > 0n);
  if (!rows.length) throw new Error("No matching open-trade rows.");

const totalRaw = rows.reduce((s, r) => s + BigInt(r.outAmount), 0n);
  let sellRaw    = (totalRaw * BigInt(Math.round(percent * 1e6))) / 1_000_000n;
  if (sellRaw === 0n) throw new Error("Too little balance.");
  console.log(`🧪 SELL CALC: totalRaw=${totalRaw}, percent=${percent}, sellRaw=${sellRaw}`);

  const walletBal = BigInt(await getTokenBalanceRaw(wallet.publicKey, mint));
  if (walletBal < sellRaw) sellRaw = walletBal;
console.log(`🧪 SELL CALC after balance: walletBal=${walletBal}, final sellRaw=${sellRaw}`);

  const slippageBps = Math.round(Number(slippageToUse) * 100);

  const quote = await getSwapQuote({
    inputMint : mint,
    outputMint: SOL_MINT,
    amount    : sellRaw.toString(),
    slippageBps,
  });
  if (!quote) throw new Error("No route.");
const tx = await executeSwap({ quote, wallet, priorityFee: priorityFeeToUse, briberyAmount, shared, });  
if (!tx) {
await alertUser(userId, "❌ Sell failed", "Sell");
    return;
  }

 const exitPriceSOL = (Number(quote.outAmount) * 10 ** decimals) /
                      (Number(sellRaw)    * 1e9);const solUSD       = await getTokenPriceApp(SOL_MINT);
const exitPriceUSD = solUSD ? +(exitPriceSOL * solUSD).toFixed(6) : null;

  const entryUsd  = rows[0].entryPriceUSD;
  let   finalTrig = triggerType;
  if (entryUsd && exitPriceUSD) {
    const pct = ((exitPriceUSD - entryUsd) / entryUsd) * 100;
    if (pct > 0 && triggerType === "sl") finalTrig = "tp";
    if (pct < 0 && triggerType === "tp") finalTrig = "sl";
  }

  /* direct FIFO close */
  await closePositionFIFO({
    userId,
    mint,
    walletId,
    walletLabel,
    percent,
    removedAmount : Number(sellRaw),
    strategy,
    triggerType   : finalTrig,
    exitPrice    : exitPriceSOL,
    exitPriceUSD,
    txHash        : tx,
    slippage: slippageToUse,                  
    slippageBps,
    decimals,
  });

  // 🔍 Check if any positions left for this mint+strategy
const stillOpen = await prisma.trade.findMany({
  where: {
    walletId: dbWallet.id,
    mint,
    strategy,
    outAmount: { gt: 0 }
  }
});

if (stillOpen.length === 0) {
  console.log(`🧹 No open trades left for ${mint}, deleting TP/SL rules...`);
  await prisma.tpSlRule.deleteMany({
    where: {
      userId,
      walletId: dbWallet.id,
      mint,
      strategy
    }
  });
}
const tokenUrl = `https://birdeye.so/token/${mint}`;
const short    = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
const pctSold  = (percent * 100).toFixed(0);
const gotSOL   = fmt(Number(quote.outAmount) / 1e9, 4);
const gotUSD   = solUSD ? fmt(gotSOL * solUSD, 2) : "?";
const time     = tsUTC();

const alertMsg = `
💼 *${strategy} Sell Executed*  (${pctSold}%)

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *Received:* ${gotSOL} SOL  ≈ \`$${gotUSD}\`
📈 *Exit*: \`$${exitPriceUSD ?? "N/A"}\`
🔖 *Trigger:* \`${finalTrig ?? "manual"}\`
👤 *Wallet:* \`${walletLabel}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();

 if (!skipAlert) {
await alertUser(userId, alertMsg, "Sell");
 }
}


/* ================================================================
 * 2)  AMOUNT-BASED SELL → performManualSellByAmount()
 * ==============================================================*/
async function performManualSellByAmount(opts) {
  const {
    amount: uiAmount,
    mint,
    strategy      = "manual",
    chatId        = null,
    context       = "default",
    walletId,
    userId,
    walletLabel   = "default",
    slippage      = 0.5,
    triggerType,
  } = opts;

   const skipAlert = triggerType === "tp" || triggerType === "sl";

let wallet;
try {
  wallet = await loadWalletKeypairArmAware(userId, walletId);
} catch (e) {
  if (e.status === 401 || e.code === "AUTOMATION_NOT_ARMED") { e.expose = true; throw e; }
  throw e;
}
  const decimals = await getMintDecimals(mint);
  let   rawAmount = BigInt(Math.floor(uiAmount * 10 ** decimals));
  if (rawAmount <= 0n) throw new Error("Amount too low.");

  const walletBal = BigInt(await getTokenBalanceRaw(wallet.publicKey, mint));
  if (walletBal < rawAmount) rawAmount = walletBal;

  const dbWallet = await prisma.wallet.findUnique({
    where : { publicKey: wallet.publicKey.toBase58() },
    select: { id: true }
  });
  if (!dbWallet) throw new Error("Wallet not in DB.");

  const rowsAll = await prisma.trade.findMany({
    where: {
      walletId: dbWallet.id,
      mint,
      strategy,
      ...(walletLabel && walletLabel !== "default" ? { walletLabel } : {})
    },
    orderBy: { timestamp: "asc" }
  });

// Handle untracked (imported) tokens with missing entryPrice
let entryPrice = null;
let notes = null;
if (rowsAll.length === 1) {
  const trade = rowsAll[0];
  const isUntracked = trade.source === "imported" || trade.entryPrice === null;
  if (isUntracked) {
    notes = "Untracked token";
    entryPrice = null;
  }
}

  const rows = rowsAll.filter(r => BigInt(r.outAmount) > 0n);

  const prefs = await getUserPreferencesByUserId(userId, context);
  const slippageToUse =
    prefs?.slippage ??
    prefs?.defaultMaxSlippage ??
    slippage;
  const mevMode        = prefs?.mevMode === "secure" ? "secure" : "fast";
  const briberyAmount  = prefs?.briberyAmount ?? 0;
  const priorityFeeToUse = prefs?.defaultPriorityFee ?? 0;
  const shared         = mevMode === "secure";

  console.log("⚙️ Applied user prefs for manual sell:", {
    slippageInput: slippage,
    slippageToUse,
    maxSlippage: prefs?.defaultMaxSlippage,
    priorityFee: priorityFeeToUse,
    mevMode,
    briberyAmount,
  });

  const slippageBps = Math.round(Number(slippageToUse) * 100);

  const quote = await getSwapQuote({
    inputMint : mint,
    outputMint: SOL_MINT,
    amount    : rawAmount.toString(),
    slippageBps,
  });
  if (!quote) throw new Error("No route.");

  const tx = await executeSwap({
    quote,
    wallet,
    shared,
    priorityFee: priorityFeeToUse,
    briberyAmount,
  });
  if (!tx) throw new Error("Sell-amount tx failed.");

  const exitPriceSOL = (Number(quote.outAmount) * 10 ** decimals) / (Number(rawAmount) * 1e9);
  const solUSD       = await getTokenPriceApp(SOL_MINT);
  const exitPriceUSD = solUSD ? +(exitPriceSOL * solUSD).toFixed(6) : null;

  const entryUsd  = rows[0].entryPriceUSD;
  let finalTrig = triggerType;
  if (entryUsd && exitPriceUSD) {
    const pct = ((exitPriceUSD - entryUsd) / entryUsd) * 100;
    if (pct > 0 && triggerType === "sl") finalTrig = "tp";
    if (pct < 0 && triggerType === "tp") finalTrig = "sl";
  }

  await closePositionFIFO({
    userId,
    mint,
    walletId,
    walletLabel,
    amountSold   : Number(rawAmount),
    removedAmount: Number(rawAmount),
    strategy,
    triggerType  : finalTrig,
    exitPrice    : exitPriceSOL,
    exitPriceUSD,
    txHash       : tx,
    slippage     : slippageToUse,
    slippageBps,
    decimals,
  });

const tokenUrl = `https://birdeye.so/token/${mint}`;
const short    = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
const soldAmount = fmt(uiAmount, 4);
const gotSOL   = fmt(Number(quote.outAmount) / 1e9, 4);
const gotUSD   = solUSD ? fmt(gotSOL * solUSD, 2) : "?";
const time     = tsUTC();

const alertMsg = `
💼 *${strategy} Sell Executed*  (${soldAmount} tokens)

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *Received:* ${gotSOL} SOL  ≈ \`$${gotUSD}\`
📈 *Exit*: \`$${exitPriceUSD ?? "N/A"}\`
🔖 *Trigger:* \`${finalTrig ?? "manual"}\`
👤 *Wallet:* \`${walletLabel}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();

 if (!skipAlert) {
await alertUser(userId, alertMsg,  "Sell");
 }
}


module.exports = {
  performManualBuy,
  performManualSell,
  performManualSellByAmount,
};
