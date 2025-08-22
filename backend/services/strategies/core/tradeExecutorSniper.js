
/* core/tradeExecutorSniper.js
 * Sniper-only trade executor with Smart-Exit watcher (TIME / LIQUIDITY / AUTHORITY-FLIP).
 *
 * This file is a fork of core/tradeExecutor.js with:
 *  - the same liveBuy/simulateBuy path for ENTER (buy)
 *  - an opt-in post-buy watcher that can trigger an EXIT (sell) based on:
 *      • TIME   — exit after maxHoldSec (optional minPnL gate)
 *      • LIQ    — exit if current warm sell-quote outAmount drops by N% from entry
 *      • AUTH   — exit if freeze authority appears/changes (rug indicator)
 *
 * Notes:
 *  - The watcher runs only if meta.postBuyWatch is provided AND meta.strategy === "Sniper".
 *  - Exit execution uses Jupiter v6 Quote API by default (node-fetch). You can replace
 *    `fetchSellQuoteJup` with your internal quote provider if desired.
 *  - This module does NOT touch other strategies. Import it ONLY from sniper.js.
 */

"use strict";

const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const crypto = require("crypto");

const { executeSwap }       = require("../../../utils/swap");
const { getMintDecimals }   = require("../../../utils/tokenAccounts");
const getTokenPriceModule   = require("../paid_api/getTokenPrice");
const getSolPrice           = getTokenPriceModule.getSolPrice;
const { sendAlert }         = require("../../../telegram/alerts");
const { trackPendingTrade } = require("./txTracker");
const { getKeypairForTrade }= require("../../../armEncryption/resolveKeypair");

// Smart-exit helpers
const QuoteWarmCache        = require("./quoteWarmCache");
const { checkFreezeAuthority } = require("./ghost");
const { recordExitReason, recordTradeClosed } = require("../../../middleware/metrics");

// Optional: if node >=18 has global fetch, this require will be unused.
let _fetch = global.fetch;
try { if (!_fetch) _fetch = require("node-fetch"); } catch (_) { /* ignore */ }

// ──────────────────────────────────────────────────────────────────────────────
// Constants & tiny caches (copied from base executor)

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const _coolOffByMint = Object.create(null);          // mint -> ts
const _idemCache     = new Map();                    // idKey -> { res:any, exp:number }
const _idTtlGate     = new Map();                    // idKey -> expiresAtMs
let __KILLED = String(process.env.KILL_SWITCH || '').trim() === '1';

function idTtlCheckAndSet(idKey, ttlSec = 60) {
  if (!idKey || !ttlSec) return true;
  const now = Date.now();
  const exp = _idTtlGate.get(idKey);
  if (exp && exp > now) return false;
  _idTtlGate.set(idKey, now + ttlSec * 1000);
  return true;
}
function requireAlive() { if (__KILLED) { const e = new Error("KILL_SWITCH_ACTIVE"); e.code="KILL"; throw e; } }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _idTtlGate.entries()) if (v <= now) _idTtlGate.delete(k);
  for (const [m, ts] of Object.entries(_coolOffByMint)) if (now - ts > 10 * 60_000) delete _coolOffByMint[m];
  for (const [k, v] of _idemCache.entries()) if (v?.exp && v.exp <= now) _idemCache.delete(k);
}, 60_000).unref?.();

// tiny caches
const _decCache   = new Map(); // mint -> { v, exp }
const _priceCache = new Map(); // key -> { v, exp }

async function getDecimalsCached(mint) {
  const e = _decCache.get(mint); const now = Date.now();
  if (e && e.exp > now) return e.v;
  const v = await getMintDecimals(mint);
  _decCache.set(mint, { v, exp: now + 3600_000 });
  return v;
}
async function getPriceCached(userId, mint) {
  const key = `${userId||'anon'}:${mint}`; const e = _priceCache.get(key); const now = Date.now();
  if (e && e.exp > now) return e.v;
  const v = (await getTokenPriceModule(userId || null, mint)) || (mint === SOL_MINT ? await getSolPrice(userId) : null);
  _priceCache.set(key, { v, exp: now + 30_000 });
  return v;
}

const toNum = (v) => (v === undefined || v === null ? null : Number(v));

// ──────────────────────────────────────────────────────────────────────────────
// Arm-aware wallet loader

async function loadWalletKeypairArmAware(userId, walletId) {
  return getKeypairForTrade(userId, walletId);
}

// ──────────────────────────────────────────────────────────────────────────────
// QUOTE: minimal Jupiter sell-quote helper (replace with internal if preferred)

async function fetchSellQuoteJup({ inputMint, outputMint, amount, slippageBps = 200 }) {
  if (!_fetch) throw new Error("fetch unavailable for sell-quote");
  const params = new URLSearchParams({
    inputMint,              // token we sell
    outputMint,             // token we receive (usually SOL or USDC)
    amount: String(amount), // in base units of inputMint
    slippageBps: String(slippageBps),
    onlyDirectRoutes: "true",
    platform: "sniper-smart-exit",
  });
  const url = `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
  const t0 = Date.now();
  const res = await _fetch(url, { method: "GET", headers: { "accept": "application/json" } });
  const txt = await res.text();
  if (!res.ok) throw new Error(`jup-quote ${res.status}: ${txt.slice(0,180)}`);
  const json = JSON.parse(txt);
  const route = json.data && Array.isArray(json.data) ? json.data[0] : null;
  if (!route) throw new Error("jup-quote: no routes");
  return { ...route, _svcLatencyMs: Date.now() - t0 };
}

// ──────────────────────────────────────────────────────────────────────────────
// CORE: live buy (identical to base) + smart-exit watcher bootstrap

async function execTrade({ quote, mint, meta, simulated = false }) {
  const {
    strategy,
    category = strategy,
    tp, sl, tpPercent, slPercent,
    slippage = 0,
    userId,
    walletId,
    // optional MEV overrides on meta:
    priorityFeeLamports: metaPriority,
    // optional idempotency
    idempotencyKey,
    idempotencyTtlMs = 60_000,
  } = meta || {};

  if (!userId || !walletId) throw new Error("userId and walletId are required in meta");
  if (String(strategy||"").toLowerCase() !== "sniper") {
    // This executor is intended for Sniper only; refuse to run for other strategies.
    throw new Error("tradeExecutorSniper is Sniper-only. Set meta.strategy='Sniper'.");
  }

  // kill switch
  requireAlive();

  // pre-send duplicate guard (60s lookback)
  const dupRecent = await prisma.trade.findFirst({
    where: { userId, walletId, mint, strategy, type: "buy", createdAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  if (dupRecent?.txHash) {
    console.log("⛔ Pre-send duplicate guard hit -> returning existing tx:", dupRecent.txHash);
    return dupRecent.txHash;
  }

  // idempotency key
  const timeBucket = Math.floor(Date.now() / 30_000); // 30s bucket
  const stableIdKey =
    idempotencyKey ||
    crypto.createHash("sha256")
      .update([userId, walletId, strategy || "", mint || "", quote?.inAmount || "", timeBucket].join("|"))
      .digest("hex");
  if (!idTtlCheckAndSet(stableIdKey, Math.max(1, Math.floor(idempotencyTtlMs / 1000)))) {
    const hit = _idemCache.get(stableIdKey);
    if (hit && (!hit.exp || hit.exp > Date.now())) {
      console.log("🧊 Idempotency TTL gate: returning cached result");
      return hit.res || null;
    }
    console.log("🧊 Idempotency TTL gate: suppressed duplicate attempt");
    return null;
  }

  // per-mint cool-off (7s default)
  const COOL_OFF_MS = 7_000;
  if (_coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < COOL_OFF_MS) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

  // Load wallet
  const wallet = await loadWalletKeypairArmAware(userId, walletId);
  console.log(`🔑 Loaded wallet pubkey: ${wallet.publicKey.toBase58()}`);

  // MEV prefs
  const userPrefs = await prisma.userPreference.findUnique({
    where: { userId_context: { userId, context: "default" } },
    select: { mevMode: true, briberyAmount: true, defaultPriorityFee: true },
  });
  const mevMode              = userPrefs?.mevMode || "fast";
  const bribeSol             = Number(userPrefs?.briberyAmount ?? 0);   // stored in SOL
  const bribeLamports        = Math.floor(bribeSol * 1e9);
  const shared               = mevMode === "secure";
  const priorityFeeLamports  = toNum(metaPriority) ?? toNum(userPrefs?.defaultPriorityFee) ?? 0;
  console.log("🛡️ Using MEV prefs:", { mevMode, shared, bribeSol, bribeLamports, priorityFeeLamports });

  // RPC quorum (optional)
  const endpointsRaw = meta.rpcEndpoints || process.env.RPC_POOL_ENDPOINTS || "";
  const endpoints = Array.isArray(endpointsRaw)
    ? endpointsRaw
    : String(endpointsRaw).split(",").map(s => s.trim()).filter(Boolean);
  const rpcQuorum   = Number(meta.rpcQuorum || process.env.RPC_POOL_QUORUM || 1);
  const rpcFanout   = Number(meta.rpcMaxFanout || process.env.RPC_POOL_MAX_FANOUT || endpoints.length || 1);
  const rpcStagger  = Number(meta.rpcStaggerMs || process.env.RPC_POOL_STAGGER_MS || 50);
  const rpcTimeout  = Number(meta.rpcTimeoutMs || process.env.RPC_POOL_TIMEOUT_MS || 10_000);
  const useQuorum   = endpoints.length > 0 && (rpcQuorum > 1 || rpcFanout > 1);
  const pool        = useQuorum ? new RpcPool(endpoints) : null;

  // Execute BUY
  let txHash = null;
  if (!simulated) {
    try {
      console.log("🔁 Executing live BUY swap…");
      txHash = await executeSwap({
        quote,
        wallet,
        shared,
        priorityFee: priorityFeeLamports,
        tipLamports: bribeLamports,
        privateRpcUrl: process.env.PRIVATE_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL,
        skipPreflight: true,
        sendRawTransaction: useQuorum
          ? (raw, opts) => pool.sendRawTransactionQuorum(raw, {
              quorum: rpcQuorum,
              maxFanout: rpcFanout,
              staggerMs: rpcStagger,
              timeoutMs: rpcTimeout,
              ...(opts || {}),
            })
          : undefined,
      });
      if (!txHash) throw new Error("swap-failed: executeSwap() returned null");
      trackPendingTrade(txHash, mint, meta.botId || strategy);
    } catch (err) {
      _coolOffByMint[mint] = Date.now();
      console.error("❌ BUY failed:", err.message);
      throw new Error(`swap-failed: ${err.message || err}`);
    }
  }

  // Enrichment (entry price/value)
  let entryPriceUSD = null, usdValue = null, entryPrice = null, decimals = null;
  try {
    const inDec  = await getDecimalsCached(quote.inputMint);
    const outDec = await getDecimalsCached(quote.outputMint);
    const inUi   = Number(quote.inAmount)  / 10 ** inDec;
    const outUi  = Number(quote.outAmount) / 10 ** outDec;

    decimals     = outDec;
    entryPrice   = inUi / outUi;
    const baseUsd = await getPriceCached(userId, quote.inputMint);
    entryPriceUSD = baseUsd ? entryPrice * baseUsd : null;
    usdValue      = baseUsd ? +((Number(quote.inAmount) / 10 ** inDec) * baseUsd).toFixed(2) : null;
  } catch (err) {
    console.error("❌ Enrichment error:", err.message);
  }

  // Wallet label
  const walletRow = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, label: true },
  });
  if (!walletRow || !walletRow.label) {
    throw new Error(`walletLabel not found for walletId ${walletId}`);
  }
  const walletLabel = walletRow.label;

  const safeJson = (data) => JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  console.log("🧩 TRADE.create payload:");
  console.log(
    safeJson({
      mint,
      entryPrice,
      entryPriceUSD,
      inAmount: BigInt(quote.inAmount),
      outAmount: BigInt(quote.outAmount),
      closedOutAmount: BigInt(0),
      strategy,
      txHash,
      userId,
      walletId,
      walletLabel,
      botId: meta.botId || strategy,
      unit:
        quote.inputMint === SOL_MINT ? "sol" :
        quote.inputMint === USDC_MINT ? "usdc" : "spl",
      slippage,
      decimals,
      usdValue,
      type: "buy",
      side: "buy",
      mevMode,
      priorityFee: priorityFeeLamports,
      briberyAmount: bribeLamports,
      mevShared: shared,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
    })
  );

  // Persist trade (best-effort)
  try {
    await prisma.trade.create({
      data: {
        userId,
        mint,
        entryPrice,
        entryPriceUSD,
        inAmount: BigInt(quote.inAmount),
        outAmount: BigInt(quote.outAmount),
        closedOutAmount: BigInt(0),
        strategy,
        txHash,
        walletId,
        walletLabel,
        botId: meta.botId || strategy,
        unit:
          quote.inputMint === SOL_MINT ? "sol" :
          quote.inputMint === USDC_MINT ? "usdc" : "spl",
        decimals,
        usdValue,
        type: "buy",
        side: "buy",
        slippage,
        mevMode,
        priorityFee: priorityFeeLamports,
        briberyAmount: bribeLamports,
        mevShared: shared,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
      },
    });
  } catch (err) {
    console.error("❌ DB write failed (trade.create):", err.message);
  }

  // Auto-create TP/SL rule if explicitly supplied
  if (((Number(tp) || 0) !== 0 || (Number(sl) || 0) !== 0)) {
    try {
      await prisma.tpSlRule.create({
        data: {
          id: uuid(),
          mint, walletId, userId, strategy,
          tp, sl, tpPercent, slPercent,
          entryPrice,
          force: false, enabled: true, status: "active", failCount: 0,
        },
      });
    } catch (_) {}
  }

  // cache idempotency result on success
  if (stableIdKey) {
    const exp = Date.now() + Math.max(1, Number(idempotencyTtlMs));
    _idemCache.set(stableIdKey, { res: txHash, exp });
  }

  /* Alert */
  const amountFmt = (quote.outAmount / 10 ** (decimals || 0)).toFixed(4);
  const impactFmt = (quote.priceImpactPct * 100).toFixed(2) + "%";
  const header = simulated ? `🧪 *Sniper Dry-Run Buy!*` : `🔫 *Sniper Buy Executed!*`;
  const msg =
    `${header}\n` +
    `• *Token:* [${mint}](https://birdeye.so/token/${mint})\n` +
    `• *Amount:* ${amountFmt}\n` +
    `• *Impact:* ${impactFmt}\n` +
    (simulated ? "• *Simulated:* ✅" : `• *Tx:* [↗️ View](https://solscan.io/tx/${txHash})`);
  await sendAlert("ui", msg, "Sniper");

  // ──────────────────────────────────────────────────────────────────────────
  // 🔍 Start post-buy watcher (non-blocking) if requested

  if (meta && meta.postBuyWatch && String(strategy).toLowerCase() === "sniper") {
    try {
      startSmartExitWatcher({
        buy: { mint, quote, entryPriceUSD, entryPrice, decimals },
        meta,
        wallet, // for exit
        userId, walletId,
      });
    } catch (e) {
      console.warn("postBuyWatch bootstrap failed:", e.message);
    }
  }

  return txHash;
}

const liveBuy     = (o) => execTrade({ ...o, simulated: false });
const simulateBuy = (o) => execTrade({ ...o, simulated: true  });

// ──────────────────────────────────────────────────────────────────────────────
// SMART-EXIT WATCHER
//
// Modes supported:
//  - smartExitMode: "time" | "liquidity" | "off" (volume mode omitted for now)
//  - Common settings under meta.postBuyWatch:
//      • intervalSec (default 5)
//      • rugDelayBlocks (default 0) – delay before exit
//      • authorityFlipExit (bool)
//      • lpDropExitPct (number) – e.g., 50 means exit if warm-quote outAmount is <50% of entry outAmount
//  - Per-mode:
//      • time: { maxHoldSec, minPnLBeforeTimeExitPct? }
//      • liquidity: { lpOutflowExitPct } (alias of lpDropExitPct)
//

function startSmartExitWatcher({ buy, meta, wallet, userId, walletId }) {
  const { mint, quote, entryPriceUSD, entryPrice, decimals } = buy || {};
  const pbw = meta.postBuyWatch || {};
  const mode = String(meta.smartExitMode || pbw.smartExitMode || "off").toLowerCase();

  if (mode === "off") return;

  const intervalSec = Number(pbw.intervalSec || 5);
  const rugDelayBlocks = Number(pbw.rugDelayBlocks || 0);
  const lpDropExitPct = Number(pbw.lpOutflowExitPct || pbw.lpDropExitPct || 50); // default 50%
  const enableAuthorityFlip = Boolean(pbw.authorityFlipExit);

  const timeCfg = (meta.smartExit && meta.smartExit.time) || {};
  const maxHoldSec = Number(timeCfg.maxHoldSec || pbw.maxHoldSec || 0);
  const minPnLPct  = Number(timeCfg.minPnLBeforeTimeExitPct || 0);

  const buyTs = Date.now();
  const entryOutLamports = BigInt(quote.outAmount);
  const warm = new QuoteWarmCache({ ttlMs: 800, maxEntries: 64 });

  let frozenAuthorityStart = null;
  let exitTriggered = false;
  let tickCount = 0;

  async function computePnLPct() {
    try {
      // try to use token USD price for output mint
      const outUsd = await getPriceCached(userId, quote.outputMint);
      if (outUsd && entryPriceUSD) {
        const change = (outUsd / entryPriceUSD) - 1;
        return change * 100;
      }
    } catch (_){}
    return null;
  }

  async function shouldExitNow() {
    // AUTHORITY-FLIP detection
    if (enableAuthorityFlip) {
      try {
        const auth = await checkFreezeAuthority(global.__SOL_CONN__ || null, quote.outputMint);
        if (frozenAuthorityStart === null) frozenAuthorityStart = auth || null;
        if ((auth && !frozenAuthorityStart) || (auth && frozenAuthorityStart && auth !== frozenAuthorityStart)) {
          return { reason: "authority-flip" };
        }
      } catch (_) {}
    }

    // LIQUIDITY / LP DROP via sell-quote shrinkage
    if (mode === "liquidity" || (lpDropExitPct > 0)) {
      try {
        const q = await getWarmSellQuote({
          inputMint: quote.outputMint,    // we SELL output token
          outputMint: quote.inputMint,    // to receive the base token (e.g., SOL)
          amount: entryOutLamports,       // try to sell full
          warm,
        });
        if (q && q.outAmount && typeof q.outAmount === "string") {
          // Compare outAmount (received base token) vs initial implied at entry
          // A large drop suggests LP pull or severe slippage.
          const initialOutBase = BigInt(quote.inAmount); // base token spent at entry
          const nowOutBase     = BigInt(q.outAmount);
          const dropPct = 100 - (Number(nowOutBase * 100n / initialOutBase));
          if (dropPct >= lpDropExitPct) {
            return { reason: "lp-pull", details: { dropPct } };
          }
        }
      } catch (_) {}
    }

    // TIME mode
    if (mode === "time" && maxHoldSec > 0) {
      const elapsedSec = Math.floor((Date.now() - buyTs) / 1000);
      if (elapsedSec >= maxHoldSec) {
        if (minPnLPct && Number.isFinite(minPnLPct)) {
          const pnl = await computePnLPct();
          if (pnl !== null && pnl < minPnLPct) {
            // require min PnL not met → keep holding
            return null;
          }
        }
        return { reason: "smart-time" };
      }
    }

    return null;
  }

  async function performExit(reasonTag, extra = {}) {
    if (exitTriggered) return;
    exitTriggered = true;

    try {
      // Optional rug delay (blocks) → approximate with ms (400ms per block default)
      if (rugDelayBlocks > 0) {
        await new Promise(r => setTimeout(r, rugDelayBlocks * 400));
      }

      // Build a fresh sell quote
      const sellQ = await getWarmSellQuote({
        inputMint: quote.outputMint,
        outputMint: quote.inputMint,
        amount: entryOutLamports,
        warm,
      });

      // Execute SELL
      const walletReload = wallet; // reuse
      const tx = await executeSwap({
        quote: sellQ,
        wallet: walletReload,
        shared: false,
        priorityFee: toNum(meta.priorityFeeLamports) ?? 0,
        tipLamports: 0,
        privateRpcUrl: process.env.PRIVATE_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL,
        skipPreflight: true,
      });

      // Metrics + alert
      try { recordExitReason(reasonTag || "other"); recordTradeClosed(); } catch(_){}
      const msg = `🚪 Smart Exit (${reasonTag}) executed for ${mint}\n• Tx: https://solscan.io/tx/${tx}`;
      await sendAlert("ui", msg, "Sniper");
      return tx;
    } catch (err) {
      console.error("❌ Smart exit failed:", err.message);
    }
    return null;
  }

  async function getWarmSellQuote({ inputMint, outputMint, amount, warm }) {
    const params = { inputMint, outputMint, amount: String(amount), slippage: 2, mode: "sell" };
    const cached = warm.get(params);
    if (cached) return cached;
    const q = await fetchSellQuoteJup({ inputMint, outputMint, amount: String(amount), slippageBps: 200 });
    warm.set(params, q);
    return q;
  }

  const timer = setInterval(async () => {
    tickCount++;
    try {
      const decision = await shouldExitNow();
      if (decision) {
        clearInterval(timer);
        await performExit(decision.reason, decision.details || {});
      }
    } catch (err) {
      console.warn("smart-exit loop error:", err.message);
    }
  }, Math.max(1000, intervalSec * 1000));
  timer.unref?.();
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports

module.exports = {
  liveBuy,
  simulateBuy,
};