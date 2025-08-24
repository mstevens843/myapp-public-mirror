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
 *  - The watcher runs only if meta.postBuyWatch is provided AND...meta.strategy === "Sniper" || meta.strategy === "Paper Trader").
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
const { closePositionFIFO } = require("../../utils/analytics/fifoReducer");

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
// ───────────────────────────────

// Best-effort: log unhandled promise rejections so the process doesn't crash silently
try {
  if (typeof process !== "undefined" && !process.__SE_UNHANDLED_HOOK) {
    process.__SE_UNHANDLED_HOOK = true;
    process.on('unhandledRejection', (reason) => {
      try {
        console.error('[SE][unhandledRejection]', reason?.stack || reason?.message || reason);
      } catch (_) {}
    });
  }
} catch (_) {}

// Smart-Exit diag helpers
function __seSafe(value) {
  try {
    return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch (e) {
    return String(value);
  }
}
function __seLog(tag, obj) {
  try {
    if (obj === undefined) { console.log(`[SE][${tag}]`); }
    else { console.log(`[SE][${tag}]`, __seSafe(obj)); }
  } catch (e) {
    console.log(`[SE][${tag}] (stringify-error)`, e?.message || e);
  }
}
// ───────────────────────────────


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
  const __stratKey = String(strategy||"").toLowerCase();
  const __isPaperStrat = (__stratKey === "paper trader") || (__stratKey === "paper_trader") || (__stratKey === "papertrader");
  if (!(__stratKey === "sniper" || __isPaperStrat)) {
    // Allow "Paper Trader" through to reuse Sniper executor in dry-run
    throw new Error("tradeExecutorSniper allowed only for Sniper or Paper Trader strategies.");
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
        priorityFeeLamports: priorityFeeLamports,
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

  // ──────────────────────────────────────────────────────────────────────────
  // Canonical Smart-Exit persistence for FE countdown (surgical addition)
  const pbw = meta.postBuyWatch || {};
  const modePersist = String(meta.smartExitMode || pbw.smartExitMode || "off").toLowerCase();
  let timeMaxHoldSecPersist = null;
  let timeMinPnLPersist = null;
  if (modePersist === "time") {
    const timeCfg = (meta.smartExit && meta.smartExit.time) || {};
    if (timeCfg.maxHoldSec != null) {
      timeMaxHoldSecPersist = Number(timeCfg.maxHoldSec);
    } else if (pbw.maxHoldSec != null) {
      timeMaxHoldSecPersist = Number(pbw.maxHoldSec);
    } else if (meta.smartExitTimeMins != null) {
      timeMaxHoldSecPersist = Number(meta.smartExitTimeMins) * 60;
    }
  // NEW: persist min-PnL gate so UI can show "(≥ +X% PnL)"
  if (timeCfg.minPnLBeforeTimeExitPct != null) {
    const n = Number(timeCfg.minPnLBeforeTimeExitPct);
    if (Number.isFinite(n)) timeMinPnLPersist = n;
  } else if (pbw.minPnLBeforeTimeExitPct != null) {
    const n = Number(pbw.minPnLBeforeTimeExitPct);
    if (Number.isFinite(n)) timeMinPnLPersist = n;
  }
}
  const __isPaper = simulated || (meta?.dryRun) || String((meta?.category||"")).toLowerCase()==="papertrader" || (meta?.openTradeExtras && meta.openTradeExtras.isPaper === true);
  const extras = {
    ...(meta.openTradeExtras || {}),
    ...(__isPaper ? { isPaper: true, simulated: true } : {}),
    smartExitMode: modePersist,
    timeMaxHoldSec:
    Number.isFinite(timeMaxHoldSecPersist) && timeMaxHoldSecPersist > 0
      ? Math.floor(timeMaxHoldSecPersist)
      : null,
  timeMinPnLBeforeTimeExitPct:
    Number.isFinite(timeMinPnLPersist) ? timeMinPnLPersist : undefined,
};

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
      priorityFeeLamports: priorityFeeLamports,
      briberyAmount: bribeLamports,
      mevShared: shared,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      extras,
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
        priorityFeeLamports: priorityFeeLamports,
        briberyAmount: bribeLamports,
        mevShared: shared,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        extras,
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

    // 🔍 Start post-buy watcher whenever smart-exit is enabled (modePersist !== "off")
     if (modePersist !== "off" && (String(strategy).toLowerCase() === "sniper" || String(strategy).toLowerCase().includes("paper"))) {    try {
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
  let mode = String(meta.smartExitMode || pbw.smartExitMode || "off").toLowerCase();

  if (mode === "off") return;

  const intervalSec = Number(pbw.intervalSec || 5);
  const rugDelayBlocks = Number(pbw.rugDelayBlocks || 0);
  let lpDropExitPct = Number(pbw.lpOutflowExitPct || pbw.lpDropExitPct || 50); // default 50%
  const enableAuthorityFlip = Boolean(pbw.authorityFlipExit);

  const timeCfg = (meta.smartExit && meta.smartExit.time) || {};
  let maxHoldSec = Number(timeCfg.maxHoldSec || pbw.maxHoldSec || 0);
  let minPnLPct  = Number(timeCfg.minPnLBeforeTimeExitPct || 0);

  const buyTs = Date.now();
  const entryOutLamports = BigInt(quote.outAmount);
  const warm = new QuoteWarmCache({ ttlMs: 800, maxEntries: 64 });
  __seLog("boot", {
    mint, strategy: meta?.strategy,
    mode, intervalSec, rugDelayBlocks, lpDropExitPct, enableAuthorityFlip,
    time: { maxHoldSec, minPnLPct },
    buyTs, entryOutLamports: entryOutLamports.toString(),
    mints: { in: quote.inputMint, out: quote.outputMint },
    walletId, userId
  });


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

        if (frozenAuthorityStart === null) {
          frozenAuthorityStart = auth || null;
        }

        if ((auth && !frozenAuthorityStart) ||
            (auth && frozenAuthorityStart && auth !== frozenAuthorityStart)) {
          console.log(
            `🚨 Authority flip detected on ${mint}! Old: ${frozenAuthorityStart || "none"}, New: ${auth}`
          );
          return { reason: "authority-flip" };
        }
      } catch (err) {
        console.warn("Authority check failed:", err.message);
      }
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
          __seLog("lp-check", {
            initialOutBase: initialOutBase.toString(),
            nowOutBase: nowOutBase.toString(),
            dropPct
          });

          if (dropPct >= lpDropExitPct) {
            console.log(
              `💧 LP outflow detected for ${mint}: drop ${dropPct.toFixed?.(2) ?? dropPct}% >= threshold ${lpDropExitPct}%`
            );
            return { reason: "lp-pull", details: { dropPct } };
          }
        }
      } catch (e) {
        console.warn("LP check failed:", e.message);
      }
    }

    // TIME mode
    if (mode === "time" && maxHoldSec > 0) {
      const elapsedSec = Math.floor((Date.now() - buyTs) / 1000);
      
        __seLog("time-check", { elapsedSec, maxHoldSec, minPnLPct });
if (elapsedSec >= maxHoldSec) {
        if (minPnLPct && Number.isFinite(minPnLPct)) {
          const pnl = await computePnLPct();
          if (pnl !== null && pnl < minPnLPct) {
            console.log(
              `⏸️ Time exit gated by minPnL for ${mint}: pnl ${pnl.toFixed?.(2) ?? pnl}% < floor ${minPnLPct}% (holding)`
            );
            return null;
          }
        }
        console.log(
          `⏰ Time exit reached for ${mint}: elapsed ${elapsedSec}s >= max ${maxHoldSec}s` +
          (minPnLPct ? ` (minPnL floor ${minPnLPct}% ok)` : "")
        );
        return { reason: "smart-time" };
      }
    }

    return null;
  }

  async function performExit(reasonTag, extra = {}) {
    if (exitTriggered) return;
    exitTriggered = true;
    __seLog("perform-exit-begin", { mint, reasonTag, paper: (meta?.dryRun === true) || String((meta?.category||"")).toLowerCase()==="papertrader" });


    console.log(`[SmartExit] Firing exit for ${mint} — reason=${reasonTag} (paper=${String((meta?.dryRun === true) || String((meta?.category||"")).toLowerCase()==="papertrader")})`);

    try {
      const __paperExit = (meta?.dryRun === true) || String((meta?.category||"")).toLowerCase()==="papertrader";
      if (__paperExit) {
        const fakeTx = `paper-exit:${uuid()}`;
        try {
          await prisma.trade.create({
            data: {
              userId, walletId,
              mint,
              type: "sell",
              side: "sell",
              strategy: String(meta?.strategy||"Paper Trader"),
              txHash: fakeTx,
              inputMint : quote.outputMint,
              outputMint: quote.inputMint,
              decimals  : decimals ?? null,
              extras: { ...(meta?.openTradeExtras||{}), isPaper: true, paperExit: true, smartExitReason: reasonTag||"paper-exit" },
            }
          });
        } catch (e) { console.warn("paper-exit persist failed:", e.message); }

        // ⬇️ Persist ClosedTrade for paper exits with real exit prices
        try {
          const sellQ = await getWarmSellQuote({
            inputMint: quote.outputMint,
            outputMint: quote.inputMint,
            amount: entryOutLamports,
            warm,
          });

        // inside performExit(), paper branch, after we fetch `sellQ`…
        const baseDec   = await getDecimalsCached(quote.inputMint);
        const tokenDec  = await getDecimalsCached(quote.outputMint);

        let exitPrice = null, exitPriceUSD = null;

        if (sellQ && sellQ.outAmount && sellQ.inAmount) {
          const baseOutUi = Number(sellQ.outAmount) / 10 ** baseDec;
          const qtyTokens = Number(entryOutLamports) / 10 ** tokenDec;
          exitPrice = qtyTokens > 0 ? (baseOutUi / qtyTokens) : null;

          const baseUsd   = await getPriceCached(userId, quote.inputMint);
          exitPriceUSD = (exitPrice != null && baseUsd) ? exitPrice * baseUsd : null;
        } else {
          console.warn("paper-exit: quote missing, persisting closedTrade without exitPrice");
        }


          const openRow = await prisma.trade.findFirst({
            where: {
              userId, walletId, mint,
              strategy: { equals: String(meta?.strategy||"Paper Trader") },
              type: "buy",
              exitedAt: null,
            },
            orderBy: { createdAt: "desc" },
          });

          if (openRow) {
            const closedData = {
              id: uuid(),
              userId,
              walletId,
              mint,
              strategy: String(meta?.strategy||"Paper Trader"),
              tokenName: openRow.tokenName || null,
              walletLabel: openRow.walletLabel || null,
              unit: openRow.unit || (quote.inputMint === SOL_MINT ? "sol" : (quote.inputMint === USDC_MINT ? "usdc" : "spl")),
              decimals: openRow.decimals ?? tokenDec ?? null,
              inAmount: openRow.inAmount,
              outAmount: openRow.outAmount,
              closedOutAmount: openRow.outAmount,
              entryPrice: openRow.entryPrice,
              entryPriceUSD: openRow.entryPriceUSD,
              exitPrice,
              exitPriceUSD,
              exitedAt: new Date(),
              createdAt: openRow.createdAt,
              extras: { ...(openRow.extras || {}), isPaper: true, paperExit: true, smartExitReason: reasonTag||"paper-exit" },
            };
            try {
              await prisma.closedTrade.create({ data: closedData });
            } catch (e) {
              console.warn("paper-exit closedTrade.create failed:", e.message);
            }

            try {
              await prisma.trade.update({
                where: { id: openRow.id },
                data: {
                  exitedAt: new Date(),
                  closedOutAmount: openRow.outAmount,
                }
              });
            } catch (e) {
              console.warn("paper-exit trade.update failed:", e.message);
            }
          }
        } catch (e) {
          console.warn("paper-exit post-processing failed:", e.message);
        }

        try { recordExitReason(reasonTag || "paper"); recordTradeClosed(); } catch(_){}
        console.log(`[SmartExit] Paper exit complete for ${mint} — reason=${reasonTag}, tx=${fakeTx}`);
        await sendAlert("ui", `🧪 Paper Smart Exit (${reasonTag}) for ${mint}\n• Tx: ${fakeTx}`, "Sniper");
        return fakeTx;
      }

      // Optional rug delay (blocks) → approximate with ms (400ms per block default)
      if (rugDelayBlocks > 0) {
        console.log(
          `⏳ Rug-delay enabled: waiting ${rugDelayBlocks} blocks (~${rugDelayBlocks * 400}ms) before exit...`
        );
        await new Promise(r => setTimeout(r, rugDelayBlocks * 400));
        console.log(`▶️ Rug-delay over, proceeding with exit.`);
      }

      // Build a fresh sell quote
      const sellQ = await getWarmSellQuote({
        inputMint: quote.outputMint,
        outputMint: quote.inputMint,
        amount: entryOutLamports,
        warm,
      });
      __seLog("sell-quote", {
        inAmount: sellQ?.inAmount, outAmount: sellQ?.outAmount,
        inputMint: sellQ?.inputMint, outputMint: sellQ?.outputMint,
        priceImpactPct: sellQ?.priceImpactPct, svcLatencyMs: sellQ?._svcLatencyMs
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
      __seLog("sell-tx-sent", { tx, mint, reasonTag });


      try {
        // token decimals (use the token mint — sellQ.inputMint)
        const tokenDecimals = await getDecimalsCached(sellQ.inputMint);

        // exit price in SOL per token
        // amounts here are atomic: outAmount = SOL lamports, inAmount = token units
        const exitPriceSOL =
          (Number(sellQ.outAmount) * 10 ** tokenDecimals) /
          (Number(sellQ.inAmount) * 1e9);

        // best-effort USD (falls back to null if price source down)
        let exitPriceUSD = null;
        try {
          const solUSD = await getPriceCached(userId, SOL_MINT);
          exitPriceUSD = solUSD ? +(exitPriceSOL * solUSD).toFixed(6) : null;
        } catch (_) {
          // non-fatal: just keep USD as null
        }

        const triggerMap = {
          "smart-time": "time",
          "lp-pull": "liquidity",
          "authority-flip": "authority",
        };

        const normalizedTrigger = triggerMap[reasonTag] || reasonTag;

        // close FIFO (full size)
        await closePositionFIFO({
          userId,
          walletId,
          walletLabel: meta.walletLabel || "default",
          mint,                                 // token mint
          strategy: meta.strategy,              // "Sniper" or "Paper Trader"
          triggerType: normalizedTrigger,    // "time" | "liquidity" | "authority-flip" etc
          amountSold   : Number(sellQ.inAmount),// raw token units sold
          removedAmount: Number(sellQ.inAmount),
          exitPrice    : exitPriceSOL,
          exitPriceUSD,
          txHash       : tx,
          slippage     : meta.slippage ?? 0.5,
          slippageBps  : Math.round((meta.slippage ?? 0.5) * 100),
          decimals     : tokenDecimals,
        });
      } catch (persistErr) {
        // Don't fail the whole smart-exit if persistence hiccups
        console.error("❌ Failed to persist sell via FIFO:", persistErr);
      }

      try { recordExitReason(reasonTag || "other"); recordTradeClosed(); } catch(_) {}
      const msg = `🚪 Smart Exit (${reasonTag}) executed for ${mint}\n• Tx: https://solscan.io/tx/${tx}`;
      console.log(`[SmartExit] Live exit complete for ${mint} — reason=${reasonTag}, tx=${tx}`);
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
    const nowTs = Date.now();
    const elapsedSec = Math.floor((nowTs - buyTs) / 1000);
    const remainingSec = maxHoldSec > 0 ? Math.max(0, maxHoldSec - elapsedSec) : null;
    __seLog("tick", { tickCount: tickCount+1, mode, elapsedSec, remainingSec, lpDropExitPct, minPnLPct });

    // 🔄 Reload latest extras each loop so FE edits/cancels apply
    try {
      const fresh = await prisma.trade.findFirst({
        where: { userId, walletId, mint, exitedAt: null },
        select: { extras: true },
      });
      if (fresh?.extras) {
        const ex = fresh.extras;
        if (ex.smartExitMode !== undefined) {
          mode = String(ex.smartExitMode || "off").toLowerCase();
        }
        if (ex.timeMaxHoldSec !== undefined && ex.timeMaxHoldSec !== null) {
          const n = Number(ex.timeMaxHoldSec);
          if (Number.isFinite(n) && n >= 0) maxHoldSec = Math.floor(n);
        }
        if (ex.timeMinPnLBeforeTimeExitPct !== undefined && ex.timeMinPnLBeforeTimeExitPct !== null) {
          const n = Number(ex.timeMinPnLBeforeTimeExitPct);
          if (Number.isFinite(n)) minPnLPct = n;
        }
        if (ex.smartLiqDropPct !== undefined && ex.smartLiqDropPct !== null) {
          const n = Number(ex.smartLiqDropPct);
          if (Number.isFinite(n)) lpDropExitPct = n;
        }
      }
    __seLog("extras-reload", { mode, maxHoldSec, minPnLPct, lpDropExitPct });
    } catch (e) {
      console.warn("extras reload failed:", e.message);
    }

    tickCount++;
    try {
      const decision = await shouldExitNow();
      if (decision) {
        console.log(`[SmartExit] Trigger detected for ${mint} — reason=${decision.reason}${decision.details?.dropPct !== undefined ? ` (drop=${decision.details.dropPct}%)` : ""}`);
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