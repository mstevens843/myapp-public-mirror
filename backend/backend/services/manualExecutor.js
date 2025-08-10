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


/* ===== Manual-exec: zero-cost safety/UX helpers ===== */
const crypto = require("crypto");

// in-memory guards
const _idemCache = new Map();      // idKey -> { res:any, exp:number }
const _idTtlGate = new Map();      // idKey -> expiresAtMs
const _coolOffByMint = Object.create(null);  // mint -> ts
let __KILLED = String(process.env.KILL_SWITCH || '').trim() === '1';

function requireAlive() { if (__KILLED) { const e = new Error("KILL_SWITCH_ACTIVE"); e.code = "KILL"; throw e; } }
function idTtlCheckAndSet(idKey, ttlSec = 60) {
  if (!idKey || !ttlSec) return true;
  const now = Date.now();
  const exp = _idTtlGate.get(idKey);
  if (exp && exp > now) return false;
  _idTtlGate.set(idKey, now + ttlSec * 1000);
  return true;
}
function classifyError(msg='') {
  const s = String(msg).toLowerCase();
  if (/slippage|insufficient (funds|liquidity)|slippage exceeded/.test(s)) return 'USER';
  if (/blockhash|node is behind|timed? out|connection|429|too many requests|rate limit|account in use/.test(s)) return 'NET';
  return 'UNKNOWN';
}

// tiny caches
const _decCache = new Map();   // mint -> { v, exp }
const _pxCache  = new Map();   // key  -> { v, exp }
async function getDecimalsCached(mint) {
  const now = Date.now(); const e = _decCache.get(mint);
  if (e && e.exp > now) return e.v;
  const v = await getMintDecimals(mint);
  _decCache.set(mint, { v, exp: now + 3600_000 });
  return v;
}
async function getPxCached(mint) {
  const key = mint; const now = Date.now(); const e = _pxCache.get(key);
  if (e && e.exp > now) return e.v;
  const v = await getTokenPriceApp(mint);      // you already call this elsewhere
  _pxCache.set(key, { v, exp: now + 30_000 });
  return v;
}

// housekeeping
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _idTtlGate.entries()) if (v <= now) _idTtlGate.delete(k);
  for (const [k, v] of _idemCache.entries()) if (v?.exp && v.exp <= now) _idemCache.delete(k);
  for (const [m, ts] of Object.entries(_coolOffByMint)) if (now - ts > 10*60_000) delete _coolOffByMint[m];
}, 60_000).unref?.();

/* stable keys (no new UI): time-bucketed for manual clicks */
function idKeyForBuy({ userId, walletId, mint, inAmount }) {
  const bucket = Math.floor(Date.now() / 30_000); // 30s
  return crypto.createHash('sha256')
    .update([userId, walletId, 'BUY', mint, String(inAmount||0), bucket].join('|'))
    .digest('hex');
}
function idKeyForSell({ userId, walletId, mint, kind, value }) {
  const bucket = Math.floor(Date.now() / 30_000); // 30s
  return crypto.createHash('sha256')
    .update([userId, walletId, 'SELL', mint, kind, String(value||0), bucket].join('|'))
    .digest('hex');
}


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

  // ===== Guards =====
  requireAlive();
  if (_coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < 7_000) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

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
  let slippageToUse =
    (prefs?.slippage ?? prefs?.defaultMaxSlippage ?? slippageInput);
  // clamp to user's max if provided
  if (prefs?.defaultMaxSlippage != null) {
    slippageToUse = Math.min(Number(slippageToUse), Number(prefs.defaultMaxSlippage));
  }
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

  // ===== Dup guards (DB + TTL) =====
  const dupRecent = await prisma.trade.findFirst({
    where: {
      userId, walletId, mint, strategy, type: "buy",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  if (dupRecent?.txHash) return { tx: dupRecent.txHash, message: "Duplicate prevented (recent buy)" };

  const buyId = idKeyForBuy({ userId, walletId, mint, inAmount });
  if (!idTtlCheckAndSet(buyId, 60)) {
    const hit = _idemCache.get(buyId);
    if (hit && (!hit.exp || hit.exp > Date.now())) return hit.res;
    return { tx: null, message: "Suppressed duplicate click" };
  }

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
    _coolOffByMint[mint] = Date.now(); // start cool-off on any failure
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
  const decimals       = await getDecimalsCached(mint);
  const entryPriceSOL  = (Number(quote.inAmount) * 10 ** decimals) / (Number(quote.outAmount) * 1e9);
  const solPrice       = await getPxCached(SOL_MINT);
  const entryPriceUSD  = solPrice ? +(entryPriceSOL * solPrice).toFixed(6) : null;
  const tokenPrice     = await getPxCached(inputMint);
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

  // cache successful result for TTL window
  _idemCache.set(buyId, { res: { tx, message: "Buy complete (cached)" }, exp: Date.now() + 60_000 });

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
        ? `+${tpPercent ?? "N/A"} % / -${slPercent ?? "N/A"} %` : "N/A"}\`
👤 *Wallet:* \`${walletLabel}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();
  await alertUser(userId, alertMsg, "Buy");

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

  // ===== Guards =====
  requireAlive();
  if (_coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < 7_000) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

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
    const tokUsd   = await getPxCached(mint) ?? 0;
    const exitPriceUSD = tokUsd;
    const exitPrice    = tokUsd / (await getPxCached(SOL_MINT));
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
  const decimals = await getDecimalsCached(mint);
  if (percent > 1) percent /= 100;

  const prefs = await getUserPreferencesByUserId(userId, context);
  let slippageToUse =
    (prefs?.slippage ?? prefs?.defaultMaxSlippage ?? slippage);
  if (prefs?.defaultMaxSlippage != null) {
    slippageToUse = Math.min(Number(slippageToUse), Number(prefs.defaultMaxSlippage));
  }
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

  // ===== TTL idempotency for sell (percent) =====
  const sellId = idKeyForSell({ userId, walletId, mint, kind: "pct", value: percent });
  if (!idTtlCheckAndSet(sellId, 60)) {
    const hit = _idemCache.get(sellId);
    if (hit && (!hit.exp || hit.exp > Date.now())) return hit.res;
    return { tx: null, message: "Suppressed duplicate click" };
  }

  const slippageBps = Math.round(Number(slippageToUse) * 100);

  const quote = await getSwapQuote({
    inputMint : mint,
    outputMint: SOL_MINT,
    amount    : sellRaw.toString(),
    slippageBps,
  });
  if (!quote) throw new Error("No route.");
  let tx;
  try {
    tx = await executeSwap({ quote, wallet, priorityFee: priorityFeeToUse, briberyAmount, shared, });
  } catch (err) {
    _coolOffByMint[mint] = Date.now();
    throw err;
  }
  if (!tx) {
    await alertUser(userId, "❌ Sell failed", "Sell");
    return;
  }

  const exitPriceSOL = (Number(quote.outAmount) * 10 ** decimals) / (Number(sellRaw) * 1e9);
  const solUSD       = await getPxCached(SOL_MINT);
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

  // cache success
  _idemCache.set(sellId, { res: { tx, message: "Sell complete (cached)" }, exp: Date.now() + 60_000 });

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

  // ===== Guards =====
  requireAlive();
  if (_coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < 7_000) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

  const skipAlert = triggerType === "tp" || triggerType === "sl";

  let wallet;
  try {
    wallet = await loadWalletKeypairArmAware(userId, walletId);
  } catch (e) {
    if (e.status === 401 || e.code === "AUTOMATION_NOT_ARMED") { e.expose = true; throw e; }
    throw e;
  }
  const decimals = await getDecimalsCached(mint);
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
  let slippageToUse =
    (prefs?.slippage ?? prefs?.defaultMaxSlippage ?? slippage);
  if (prefs?.defaultMaxSlippage != null) {
    slippageToUse = Math.min(Number(slippageToUse), Number(prefs.defaultMaxSlippage));
  }
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

  // TTL gate for sell-by-amount clicks
  const sellId = idKeyForSell({ userId, walletId, mint, kind: "amt", value: uiAmount });
  if (!idTtlCheckAndSet(sellId, 60)) {
    const hit = _idemCache.get(sellId);
    if (hit && (!hit.exp || hit.exp > Date.now())) return hit.res;
    return { tx: null, message: "Suppressed duplicate click" };
  }

  const slippageBps = Math.round(Number(slippageToUse) * 100);

  const quote = await getSwapQuote({
    inputMint : mint,
    outputMint: SOL_MINT,
    amount    : rawAmount.toString(),
    slippageBps,
  });
  if (!quote) throw new Error("No route.");

  let tx;
  try {
    tx = await executeSwap({
      quote,
      wallet,
      shared,
      priorityFee: priorityFeeToUse,
      briberyAmount,
    });
  } catch (err) {
    _coolOffByMint[mint] = Date.now();
    throw new Error("Sell-amount tx failed.");
  }
  if (!tx) throw new Error("Sell-amount tx failed.");

  const exitPriceSOL = (Number(quote.outAmount) * 10 ** decimals) / (Number(rawAmount) * 1e9);
  const solUSD       = await getPxCached(SOL_MINT);
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

  // cache success
  _idemCache.set(sellId, { res: { tx, message: "Sell complete (cached)" }, exp: Date.now() + 60_000 });

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