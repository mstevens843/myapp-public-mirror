// backend/services/strategies/core/tradeExecutorTurbo.js
/**
 * turboTradeExecutor.js – Turbo-path trade executor (+ Execution Edges)
 * --------------------------------------------------------------------
 * • Arm-to-Trade envelope decryption (in-memory DEK)
 * • Ultra-fast swap via executeSwapTurbo() / executeSwapJitoBundle()
 * • Leader-timed send, warm quote cache, retry matrix, idempotency TTL
 * • NEW: Deterministic idempotency key + crash-safe resume window
 * • NEW: Liquidity-aware sizing (price impact / pool % / min USD)
 * • NEW: Probe buy then scale (fast two-step) with shared idKey
 * • NEW: Private relay/shadow mempool (feature-flag) fire-and-forget (fastest ack wins)
 * • Post-trade side-effects (non-blocking):
 *     – TP/SL rule insert
 *     – Telegram alert
 *     – Ghost-mode forwarding
 *     – Auto-rug check & exit
 */

'use strict';

const crypto = require('crypto');
const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair, Connection, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");

// --- Error classification (NET / USER / UNKNOWN) ---
const NET_ERRS = [/blockhash/i, /node is behind/i, /timed? out/i, /connection/i, /getblockheight timed out/i];
const USER_ERRS = [/slippage/i, /insufficient funds/i, /mint.*not found/i, /account in use/i, /slippage exceeded/i];
function classifyError(msg = '') {
  const lower = String(msg).toLowerCase();
  if (USER_ERRS.some(r => r.test(lower))) return 'USER';
  if (NET_ERRS.some(r => r.test(lower)))  return 'NET';
  return 'UNKNOWN';
}

const {
  executeSwapTurbo,
  executeSwapJitoBundle,
  getSwapQuote,
} = require("../../../utils/swap");
const { getMintDecimals } = require("../../../utils/tokenAccounts");
const getTokenPrice = require("../paid_api/getTokenPrice");
const getSolPrice = getTokenPrice.getSolPrice;
const { sendAlert } = require("../../../telegram/alerts");
const { trackPendingTrade } = require("./txTracker");

// Auto slippage governor and post-trade queue
const { SlippageGovernor } = require('./slippageGovernor');
const postTradeQueue = require('./postTradeQueue');

// 🔧 Existing infra
const LeaderScheduler = require("./leaderScheduler");
const QuoteWarmCache  = require("./quoteWarmCache");

// Additional helpers for Turbo enhancements
const JitoFeeController = require("./jitoFeeController");
const { directSwap } = require("../../../utils/raydiumDirect");
const metricsLogger = require("../logging/metrics"); // keep preexisting metrics

// ── Risk gating ────────────────────────────────────────────────────────────
// Import the shared passes helper.  This helper runs a series of pre‑trade
// heuristics (price/volume filters and developer/creator risk checks).  We
// invoke it ahead of any quote retrieval to avoid wasting time on unsafe
// tokens.  The dev/creator heuristics are intentionally conservative: if
// either the holder concentration or LP burn percentage exceeds the
// configured thresholds (via cfg.devWatch), the token is immediately
// rejected.  Passing a dummy fetchOverview and zero thresholds disables
// price/volume/mcap filters so only devWatch logic runs.  See
// backend/services/strategies/core/passes.js for details.
const { passes } = require('./passes');
const idempotencyStore = require("../../../utils/idempotencyStore"); // existing in your repo (short-TTL cache)

// 🔧 NEW core modules added by Prompt 1 (shadow mempool + deterministic idempotency + sizing + probe)
const RelayClient = require('./relays/relayClient');                 // new abstraction (feature-flag)
const CoreIdemStore = require('./idempotencyStore');                 // crash-safe resume window (disk-backed)
const { sizeTrade } = require('./liquiditySizer');                   // liquidity-aware sizing
const { performProbe } = require('./probeBuyer');                    // micro-buy then scale

// 🔐  Arm / envelope-crypto helpers
const { getDEK } = require("../../../armEncryption/sessionKeyCache");
const {
  decryptPrivateKeyWithDEK,
} = require("../../../armEncryption/envelopeCrypto");
const { decrypt } = require("../../../middleware/auth/encryption");

// 👻  Ghost utilities
const {
  forwardTokens,
  checkFreezeAuthority,
} = require("./ghost");

// NEW (Prompt 3): Quorum RPC / Blockhash TTL
const RpcQuorumClient = require('./rpcQuorumClient');

const SOL_MINT =
  "So11111111111111111111111111111111111111112";
const USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const toNum = (v) =>
  v === undefined || v === null ? null : Number(v);

/* ──────────────────────────────────────────────
 *  Metrics helpers (preserve existing, add new)
 * ──────────────────────────────────────────── */
function inc(counter, value = 1, labels) {
  try {
    if (typeof metricsLogger.increment === 'function') {
      metricsLogger.increment(counter, value, labels);
    }
  } catch (_) {}
}
// Provide a thin wrapper around the metrics observer.  Accept an optional
// labels object to avoid referencing an undefined identifier.  This helper
// never throws and will silently ignore metrics when the underlying
// implementation is missing.  Without an explicit labels parameter the
// call sites will fall back to an empty object, preserving existing
// behaviour but eliminating the reference error.
function observe(name, value, labels = {}) {
  try {
    if (typeof metricsLogger.observe === 'function') {
      metricsLogger.observe(name, value, labels);
    }
  } catch (_) {
    /* noop */
  }
}

/* ──────────────────────────────────────────────
 *  Warm Quote Cache (shared per TTL bucket)
 * ──────────────────────────────────────────── */
const _quoteCaches = new Map();
function getQuoteCache(ttlMs = 600) {
  const key = Number(ttlMs) || 0;
  if (!_quoteCaches.has(key)) {
    _quoteCaches.set(key, new QuoteWarmCache({ ttlMs: key, maxEntries: 200 }));
  }
  return _quoteCaches.get(key);
}

/* ──────────────────────────────────────────────
 *  Deterministic Idempotency (TTL gate + crash-safe)
 * ──────────────────────────────────────────── */
const _idTtlGate = new Map(); // idKey -> expiresAtMs
function idTtlCheckAndSet(idKey, ttlSec = 60) {
  if (!idKey || !ttlSec) return true;
  const now = Date.now();
  const exp = _idTtlGate.get(idKey);
  if (exp && exp > now) return false;
  _idTtlGate.set(idKey, now + ttlSec * 1000);
  return true;
}
// Crash-safe store (disk/DB fallback) — singleton
const coreIdem = new CoreIdemStore(
  {
    ttlSec: Number(process.env.IDEMPOTENCY_TTL_SEC) || 90,
    salt: process.env.IDEMPOTENCY_SALT || '',
    resumeFromLast: true,
  },
  { increment: inc }
);
let _coreIdemInited = false;

/* ──────────────────────────────────────────────
 *  Leader Scheduler (lazy singleton by validator+rpc)
 * ──────────────────────────────────────────── */
const _leaderSchedulers = new Map(); // rpcUrl|validator -> LeaderScheduler
function getLeaderScheduler(conn, validatorIdentity) {
  const rpc = (conn?._rpcEndpoint) || 'default';
  const key = `${rpc}|${validatorIdentity || 'none'}`;
  if (!_leaderSchedulers.has(key)) {
    _leaderSchedulers.set(key, new LeaderScheduler(conn, validatorIdentity));
  }
  return _leaderSchedulers.get(key);
}

/* ──────────────────────────────────────────────
 *  Arm-aware key loader
 * ──────────────────────────────────────────── */
async function loadWalletKeypairArmAware(userId, walletId) {
  const row = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      encrypted: true,
      isProtected: true,
      privateKey: true,
    },
  });
  if (!row) throw new Error("Wallet not found in DB.");

  const aad = `user:${userId}:wallet:${walletId}`;

  /* Envelope path */
  if (row.encrypted?.v === 1) {
    const dek = getDEK(userId, walletId);
    if (!dek) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { requireArmToTrade: true },
      });
      if (row.isProtected || user?.requireArmToTrade) {
        const err = new Error("Automation not armed");
        err.status = 401;
        err.code = "AUTOMATION_NOT_ARMED";
        throw err;
      }
      throw new Error("Protected wallet requires an armed session");
    }
    const pkBuf = decryptPrivateKeyWithDEK(row.encrypted, dek, aad);
    try {
      if (pkBuf.length !== 64)
        throw new Error(
          `Unexpected secret key length: ${pkBuf.length}`
        );
      return Keypair.fromSecretKey(new Uint8Array(pkBuf));
    } finally {
      pkBuf.fill(0);
    }
  }

  /* Legacy path */
  if (row.privateKey) {
    const secretBase58 = decrypt(row.privateKey, { aad });
    const secretBytes = bs58.decode(secretBase58.trim());
    if (secretBytes.length !== 64)
      throw new Error("Invalid secret key length after legacy decryption");
    return Keypair.fromSecretKey(secretBytes);
  }

  throw new Error("Wallet has no usable key material");
}

/* ──────────────────────────────────────────────
 *  Local helpers: deterministic idKey + sizing + private relay
 * ──────────────────────────────────────────── */
function computeStableIdKey({ userId, walletId, mint, amount, slotBucket, salt }) {
  const s = String(salt || '');
  const input = [userId, walletId, mint, amount, slotBucket ?? '', s].join('|');
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Clean sizing helper that can refresh quote for the chosen amount
async function applyLiquiditySizing({ baseQuote, sizingCfg, priceImpactEstimator, refreshQuote }) {
  if (!sizingCfg) return baseQuote;
  const poolReserves = Number(baseQuote?.poolReserves) || null; // if provided by your quote, else null
  const amount = Number(baseQuote?.inAmount);
  let finalAmount = amount;
  try {
    finalAmount = await sizeTrade({
      amount,
      poolReserves,
      priceImpactEstimator,
      config: sizingCfg,
      metrics: { observe },
    });
  } catch (_) {
    finalAmount = amount;
  }
  if (!finalAmount || finalAmount === amount) return baseQuote;
  if (typeof refreshQuote === 'function') {
    try {
      const fresh = await refreshQuote(finalAmount);
      if (fresh) return fresh;
    } catch (_) {}
  }
  // Fallback if refresh failed: just reduce inAmount
  return { ...baseQuote, inAmount: String(finalAmount) };
}

function startPrivateRelayIfEnabled({ privateRelay, walletPubkey, mint, idKey, amount }) {
  if (!privateRelay || !privateRelay.enabled) return { ack: Promise.resolve(null) };
  const client = new RelayClient(privateRelay, { increment: inc });
  const payload = { walletPublicKey: walletPubkey, mint, idKey, amount };
  // Fire-and-forget; but capture first ack to mark relay_win_total
  const ack = client.send(payload);
  return { client, ack };
}

/* ──────────────────────────────────────────────
 *  Main executor
 * ──────────────────────────────────────────── */
async function execTrade({ quote, mint, meta, simulated = false }) {
  const {
    strategy,
    category = strategy,
    tp,
    sl,
    tpPercent,
    slPercent,
    slippage = 0,
    userId,
    walletId,
    turboMode = true, // always true for this file
    privateRpcUrl,
    skipPreflight = true,
    ghostMode,
    coverWalletId,
    autoRug,
    tokenName,
    botId,

    // NEW: leader timing + jito fee control + retry matrix
    validatorIdentity,
    leaderTiming = { enabled: false, preflightMs: 220, windowSlots: 2 },
    bundleStrategy = 'topOfBlock',
    cuAdapt,
    cuPriceMicroLamportsMin,
    cuPriceMicroLamportsMax,
    tipCurve = 'flat',

    // NEW: retry + ttl
    quoteTtlMs = 600,
    retryPolicy = { max: 3, bumpCuStep: 2000, bumpTipStep: 1000, routeSwitch: true, rpcFailover: true },

    // routing flags remain same
    multiRoute,
    splitTrade,
    allowedDexes,
    excludedDexes,

    // fallback flags
    directAmmFallback,
    impactAbortPct,
    dynamicSlippageMaxPct,

    // Jito path flags
    useJitoBundle,
    jitoTipLamports,
    jitoRelayUrl,

    // priority fee handling
    priorityFeeLamports,

    // extra post-buy watcher
    postBuyWatch,

    // iceberg
    iceberg,

    // NEW: Execution Edges config blocks (optional in meta)
    privateRelay,
    idempotency, // { ttlSec, salt, resumeFromLast, slotBucket? }
    sizing,      // { maxImpactPct, maxPoolPct, minUsd }
    probe,       // { enabled, usd, scaleFactor, abortOnImpactPct, delayMs }
    slippageAuto,
    postTx,

    // Prompt 3: RPC quorum config (optional)
    rpc,         // { quorum: {size, require}, blockhashTtlMs, endpoints? }
    rpcEndpoints // legacy array/string (failover)
  } = meta;

  if (!_coreIdemInited) {
    await coreIdem.init().catch(() => {});
    _coreIdemInited = true;
  }

  if (!userId || !walletId)
    throw new Error("userId and walletId are required in meta");

  const wallet = await loadWalletKeypairArmAware(userId, walletId);

  // pick RPC for this attempt; may be rotated by retry loop
  let currentRpcUrl = privateRpcUrl || process.env.PRIVATE_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL;
  let conn = new Connection(currentRpcUrl, 'confirmed');

  // ---- Quorum RPC client (for blockhash TTL prewarm) ----
  let endpoints = [];
  if (rpc && (Array.isArray(rpc.endpoints) || typeof rpc.endpoints === 'string')) {
    endpoints = Array.isArray(rpc.endpoints) ? rpc.endpoints.slice() : String(rpc.endpoints).split(',').map(s => s.trim());
  } else if (Array.isArray(rpcEndpoints)) {
    endpoints = rpcEndpoints.slice();
  }
  endpoints = endpoints.filter(Boolean);
  const quorumCfg = (rpc && rpc.quorum) || { size: Math.max(1, endpoints.length), require: Math.min(2, Math.max(1, endpoints.length)) };
  const blockhashTtlMs = (rpc && rpc.blockhashTtlMs) || 2500;
  const quorumClient = endpoints.length ? new RpcQuorumClient({ endpoints, quorum: quorumCfg, blockhashTtlMs, commitment: 'confirmed' }) : null;

  // helper: refresh recent blockhash on primary + peers (before send / retries)
  async function _preSendRefresh() {
    try {
      await conn.getLatestBlockhash('confirmed');
      metricsLogger.recordBlockhashRefresh?.(conn._rpcEndpoint || 'primary');
    } catch (_) { /* ignore */ }
    if (quorumClient) {
      try {
        const conns = quorumClient.getConnections();
        await Promise.allSettled(conns.map(c => quorumClient.refreshIfExpired(c)));
      } catch (_) { /* ignore */ }
    }
  }

  // ---- LEADER TIMING HOLD (pre-send) ----
  if (leaderTiming?.enabled && bundleStrategy !== 'private' && validatorIdentity) {
    try {
      const sched = getLeaderScheduler(conn, validatorIdentity);
      const { holdMs } = await sched.shouldHoldAndFire(Date.now(), leaderTiming);
      if (holdMs > 0) {
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, holdMs));
        metricsLogger.recordTiming?.('leader_hold_ms', Date.now() - t0);
        // fired_in_leader_window counted as success path later (implicit)
      }
    } catch (e) {
      // degrade gracefully: no hold
    }
  }

  /* MEV prefs */
  const prefs = await prisma.userPreference.findUnique({
    where: { userId_context: { userId, context: "default" } },
    select: {
      mevMode: true,
      briberyAmount: true,
      defaultPriorityFee: true,
    },
  });
  const mevMode = prefs?.mevMode || "fast";
  const briberyAmountBase = prefs?.briberyAmount ?? 0;
  const shared = mevMode === "secure";
  const basePriorityFeeLamports =
    toNum(priorityFeeLamports) ??
    toNum(prefs?.defaultPriorityFee) ??
    0;

  // ── Deterministic idKey (stable across restarts) ───────────────────────────
  const idemSalt = idempotency?.salt ?? process.env.IDEMPOTENCY_SALT ?? '';
  const slotBucket = idempotency?.slotBucket ?? meta.slotBucket ?? '';
  const stableIdKey =
    meta.idempotencyKey ||
    computeStableIdKey({
      userId,
      walletId,
      mint,
      amount: quote?.inAmount ?? '',
      slotBucket,
      salt: idemSalt,
    });

  const ttlSec = Number(idempotency?.ttlSec ?? 60);
  if (!idTtlCheckAndSet(stableIdKey, ttlSec)) {
    const cached = idempotencyStore.get(stableIdKey) || (await coreIdem.get?.(stableIdKey));
    if (cached) return cached;
    inc('idempotency_blocked_total', 1);
    throw new Error('duplicate attempt blocked');
  }
  // Crash-safe resume stamp (pending)
  try { await coreIdem.persist?.().catch(() => {}); } catch (_) {}

  // Dynamic slippage limit
  let effSlippage = slippage;
  if (dynamicSlippageMaxPct) {
    const ds = Number(dynamicSlippageMaxPct);
    if (Number.isFinite(ds) && ds > 0) {
      effSlippage = Math.min(slippage, ds / 100);
    }
  }

  // Auto slippage governor
  if (slippageAuto && typeof slippageAuto === 'object' && slippageAuto.enabled) {
    try {
      const gov = new SlippageGovernor(slippageAuto);
      if (quote && quote.priceImpactPct != null) {
        gov.observeSpread((quote.priceImpactPct || 0) * 100);
      }
      effSlippage = gov.getAdjusted(effSlippage);
    } catch (_) {}
  }

  // Impact guard
  if (impactAbortPct > 0 && quote?.priceImpactPct != null) {
    const pct = quote.priceImpactPct * 100;
    if (pct > impactAbortPct) {
      metricsLogger.recordFail?.('impact-abort');
      throw new Error('abort: price impact too high');
    }
  }

  // Warm quote cache wrapper
  const quoteCache = getQuoteCache(quoteTtlMs);
  async function getWarmQuote(params) {
    const key = {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: String(params.amount),
      slippage: params.slippage,
      mode: bundleStrategy,
    };
    const cached = quoteCache.get(key);
    if (cached) return cached;
    const t0 = Date.now();
    const fresh = await getSwapQuote({
      ...params,
      multiRoute,
      splitTrade,
      allowedDexes,
      excludedDexes,
    });
    metricsLogger.recordTiming?.('quote_latency_ms', Date.now() - t0);
    if (fresh) quoteCache.set(key, fresh);
    return fresh;
  }

  // Liquidity-aware sizing (with quote refresh)
  const sizedQuote = await applyLiquiditySizing({
    baseQuote: { ...quote, slippage: effSlippage },
    sizingCfg: sizing,
    priceImpactEstimator: async (a) => {
      const q = await getWarmQuote({
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        amount: String(a),
        slippage: effSlippage,
      });
      return (q?.priceImpactPct ?? 0) * 100;
    },
    refreshQuote: async (newAmount) => {
      return await getWarmQuote({
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        amount: String(newAmount),
        slippage: effSlippage,
      });
    }
  }).catch(() => quote);

  if (!sizedQuote) throw new Error('sizing/quote unavailable');
  if (Number(sizedQuote.inAmount) !== Number(quote.inAmount)) {
    const original = Number(quote.inAmount);
    const reduced = Number(sizedQuote.inAmount);
    const reducedPct = original > 0 ? ((original - reduced) / original) * 100 : 0;
    observe('sizing_reduced_pct', reducedPct);
    try {
      const finalImpactPct = (sizedQuote.priceImpactPct ?? 0) * 100;
      observe('price_impact_pct', finalImpactPct);
    } catch (_) {}
  }

  // Private Relay
  const walletPubkeyStr =
    (wallet.publicKey && wallet.publicKey.toBase58) ? wallet.publicKey.toBase58() :
    (wallet.publicKey && wallet.publicKey.toString) ? wallet.publicKey.toString() :
    String(wallet.publicKey || '');

  const { client: relayClient, ack: relayAck } = startPrivateRelayIfEnabled({
    privateRelay,
    walletPubkey: walletPubkeyStr,
    mint,
    idKey: stableIdKey,
    amount: sizedQuote.inAmount,
  });

  // Sender
  async function sendOnce(localQuote) {
    let txHash = null;
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(retryPolicy?.max ?? 3));
    let briberyAmount = Number(briberyAmountBase) || 0;
    let priorityFee = Number(basePriorityFeeLamports) || 0;
    let jitoMode = !!useJitoBundle;
    let usedDirect = false;

    // Pre-send blockhash prewarm for first attempt
    await _preSendRefresh();

    while (attempt < maxAttempts && !txHash) {
      try {
        // Also refresh before each attempt if TTL expired
        await _preSendRefresh();

        // Direct AMM fallback on first attempt when quote latency high
        if (!usedDirect && directAmmFallback && typeof meta.quoteLatencyMs === 'number' && meta.quoteLatencyMs > 250 && attempt === 0) {
          const startSlot = await conn.getSlot();
          txHash = await directSwap({
            wallet,
            inputMint: localQuote.inputMint,
            outputMint: localQuote.outputMint,
            amount: String(localQuote.inAmount),
            slippage: effSlippage,
            privateRpcUrl: currentRpcUrl,
          });
          const endSlot = await conn.getSlot();
          if (txHash) {
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            metricsLogger.recordSuccess?.();
            usedDirect = true;
            // Capture lead time relative to pool detection
            const leadTime = meta && meta.detectedAt ? (Date.now() - meta.detectedAt) : null;
            // Record the pending transaction with metrics
            try {
              trackPendingTrade(txHash, mint, strategy, {
                slot: endSlot,
                cuUsed: null,
                cuPrice: priorityFee,
                tip: briberyAmount,
                route: 'direct',
                slippage: effSlippage,
                fillPct: null,
                leadTime_ms: leadTime,
              });
            } catch (_) {}
            break;
          } else {
            metricsLogger.recordFail?.('direct-swap-fail');
          }
        }

        // Choose path (Jito or Turbo)
        if (jitoMode) {
          // Instantiate controller with potential custom curves
          const controller = new JitoFeeController({
            cuAdapt,
            cuPriceMicroLamportsMin,
            cuPriceMicroLamportsMax,
            cuPriceCurve: meta?.cuPriceCurve,
            tipCurveCoefficients: meta?.tipCurveCoefficients,
            tipCurve,
            baseTipLamports: jitoTipLamports || 1000,
          });
          const fees = controller.getFee(attempt);
          const startSlot = await conn.getSlot();
          txHash = await executeSwapJitoBundle({
            quote: localQuote,
            wallet,
            shared,
            priorityFee: fees.computeUnitPriceMicroLamports,
            briberyAmount: 0,
            jitoRelayUrl,
          });
          const endSlot = await conn.getSlot();
          if (txHash) {
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            metricsLogger.recordSuccess?.();
            // Log pending tx with metrics
            const leadTime = meta && meta.detectedAt ? (Date.now() - meta.detectedAt) : null;
            try {
              trackPendingTrade(txHash, mint, strategy, {
                slot: endSlot,
                cuUsed: null,
                cuPrice: fees.computeUnitPriceMicroLamports,
                tip: fees.tipLamports,
                route: 'jito',
                slippage: effSlippage,
                fillPct: null,
                leadTime_ms: leadTime,
              });
            } catch (_) {}
          }
        } else {
          const startSlot = await conn.getSlot();
          txHash = await executeSwapTurbo({
            quote: localQuote,
            wallet,
            shared,
            priorityFee,
            briberyAmount,
            privateRpcUrl: currentRpcUrl,
            skipPreflight,
          });
          const endSlot = await conn.getSlot();
          if (txHash) {
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            metricsLogger.recordSuccess?.();
            // Log pending tx with metrics
            const leadTime = meta && meta.detectedAt ? (Date.now() - meta.detectedAt) : null;
            try {
              trackPendingTrade(txHash, mint, strategy, {
                slot: endSlot,
                cuUsed: null,
                cuPrice: priorityFee,
                tip: briberyAmount,
                route: 'turbo',
                slippage: effSlippage,
                fillPct: null,
                leadTime_ms: leadTime,
              });
            } catch (_) {}
          }
        }

        if (!txHash) throw new Error('swap-failed');
      } catch (err) {
        attempt += 1;
        const cls = classifyError(err?.message || err?.toString());

        // USER errors: surface immediately
        if (cls === 'USER') {
          metricsLogger.recordFail?.('user-error');
          throw err;
        }

        // If max attempts reached, stop
        if (attempt >= maxAttempts) {
          metricsLogger.recordFail?.(cls === 'NET' ? 'net-error' : 'unknown-error');
          throw err;
        }

        // UNKNOWN: single conservative CU bump, then stop (no chain of bumps)
        if (cls === 'UNKNOWN') {
          if (attempt === 1) {
            priorityFee += Number(retryPolicy.bumpCuStep || 2000);
            metricsLogger.recordRetry?.();
          } else {
            throw err;
          }
        }

        // NET: bump exactly one dimension per attempt (CU → tip → route → RPC)
        if (cls === 'NET') {
          if (attempt === 1) {
            priorityFee += Number(retryPolicy.bumpCuStep || 2000);
          } else if (attempt === 2) {
            briberyAmount += Number(retryPolicy.bumpTipStep || 1000);
          } else if (attempt === 3 && retryPolicy.routeSwitch) {
            jitoMode = !jitoMode;
          } else if (attempt >= 4 && retryPolicy.rpcFailover) {
            const endpointsList = endpoints.length ? endpoints : (Array.isArray(meta.rpcEndpoints) ? meta.rpcEndpoints : []);
            if (endpointsList.length > 1) {
              const idx = (endpointsList.indexOf(currentRpcUrl) + 1) % endpointsList.length;
              currentRpcUrl = endpointsList[idx] || currentRpcUrl;
              conn = new Connection(currentRpcUrl, 'confirmed');
            }
          }
          metricsLogger.recordRetry?.();
        }

        // Refresh quote (and blockhash) after changes
        try {
          await _preSendRefresh();
          const qRes = await getWarmQuote({
            inputMint: localQuote.inputMint,
            outputMint: localQuote.outputMint,
            amount: String(localQuote.inAmount),
            slippage: effSlippage,
          });
          if (qRes) localQuote = qRes;
        } catch (_) { /* keep last */ }
      }
    }

    // Do not await any relay ack here; avoid adding latency to hot path
    return txHash;
  }

  // Probe Buy then Scale
  let txHash = null;
  if (probe?.enabled) {
    inc('probe_sent_total', 1);

    const scale = Number(probe.scaleFactor || 4);
    const probeIn = Math.max(1, Math.floor(Number(sizedQuote.inAmount) / Math.max(2, scale)));

    const probeQuote = await getWarmQuote({
      inputMint: sizedQuote.inputMint,
      outputMint: sizedQuote.outputMint,
      amount: String(probeIn),
      slippage: effSlippage,
    });

    await _preSendRefresh();
    const probeTx = await sendOnce(probeQuote);

    const liveImpactPct = (probeQuote?.priceImpactPct ?? 0) * 100;
    if (probe.abortOnImpactPct != null && liveImpactPct > Number(probe.abortOnImpactPct)) {
      inc('probe_abort_total', 1);
      try { idempotencyStore.set(stableIdKey, probeTx || 'probe-aborted'); } catch {}
      return probeTx || null;
    }

    const delayMs = Number(probe.delayMs || 250);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const remaining = Math.max(0, Number(sizedQuote.inAmount) - probeIn);
    if (remaining > 0) {
      const scaleQuote = await getWarmQuote({
        inputMint: sizedQuote.inputMint,
        outputMint: sizedQuote.outputMint,
        amount: String(remaining),
        slippage: effSlippage,
      });
      await _preSendRefresh();
      const scaleTx = await sendOnce(scaleQuote);
      txHash = scaleTx || probeTx || null;
      if (scaleTx) inc('probe_scale_success_total', 1);
    } else {
      txHash = probeTx || null;
      inc('probe_scale_success_total', 1);
    }
  } else {
    await _preSendRefresh();
    txHash = await sendOnce(sizedQuote);
  }

  // Cache idempotency key on success
  if (!simulated && stableIdKey && txHash) {
    try { idempotencyStore.set(stableIdKey, txHash); } catch {}
    try { coreIdem.markSuccess?.(stableIdKey); } catch {}
  }

  /* ——— 2️⃣  Enrichment ——— */
  let entryPriceUSD = null,
    usdValue = null,
    entryPrice = null,
    decimals = null;
  try {
    const inDec = await getMintDecimals(sizedQuote.inputMint);
    const outDec = await getMintDecimals(sizedQuote.outputMint);
    const inUi = Number(sizedQuote.inAmount) / 10 ** inDec;
    const outUi = Number(sizedQuote.outAmount) / 10 ** outDec;
    decimals = outDec;
    entryPrice = inUi / outUi;
    const baseUsd =
      (await getTokenPrice(userId, sizedQuote.inputMint)) ||
      (sizedQuote.inputMint === SOL_MINT
        ? await getSolPrice(userId)
        : null);
    entryPriceUSD = baseUsd ? entryPrice * baseUsd : null;
    usdValue = baseUsd
      ? +((sizedQuote.inAmount / 1e9) * baseUsd).toFixed(2)
      : null;
  } catch (e) {
    console.warn("Enrichment error:", e.message);
  }

  /* ——— 3️⃣  Trade record ——— */
  const walletRow = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { label: true },
  });
  const walletLabel = walletRow?.label ?? "Unnamed";

  const dup = await prisma.trade.findFirst({
    where: {
      userId,
      mint,
      strategy,
      type: "buy",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (!dup && txHash) {
    await prisma.trade.create({
      data: {
        id: uuid(),
        mint,
        tokenName: tokenName ?? null,
        entryPrice,
        entryPriceUSD,
        inAmount: BigInt(sizedQuote.inAmount),
        outAmount: BigInt(sizedQuote.outAmount),
        closedOutAmount: BigInt(0),
        strategy,
        txHash,
        userId,
        walletId,
        walletLabel,
        botId: botId || strategy,
        unit:
          sizedQuote.inputMint === SOL_MINT
            ? "sol"
            : sizedQuote.inputMint === USDC_MINT
            ? "usdc"
            : "spl",
        decimals,
        usdValue,
        type: "buy",
        side: "buy",
        slippage: effSlippage,
        mevMode,
        priorityFee: undefined,
        briberyAmount: undefined,
        mevShared: shared,
        inputMint: sizedQuote.inputMint,
        outputMint: sizedQuote.outputMint,
      },
    });
  }

  /* ——— 4️⃣  Post-trade side-effects (non-blocking) ——— */
  (async () => {
    const connPost = new Connection(
      process.env.SOLANA_RPC_URL,
      "confirmed"
    );

    /* TP/SL rule */
    if (
      !["rotationbot", "rebalancer"].includes(
        strategy.toLowerCase()
      ) &&
      ((Number(tp) || 0) !== 0 || (Number(sl) || 0) !== 0)
    ) {
      await prisma.tpSlRule.create({
        data: {
          id: uuid(),
          mint,
          walletId,
          userId,
          strategy,
          tp,
          sl,
          tpPercent,
          slPercent,
          entryPrice,
          force: false,
          enabled: true,
          status: "active",
          failCount: 0,
        },
      });
    }

    /* Telegram alert */
    try {
      const amountFmt = txHash ? (sizedQuote.outAmount / 10 ** (decimals || 9)).toFixed(4) : "0";
      const impactFmt =
        ((sizedQuote.priceImpactPct ?? 0) * 100).toFixed(2) + "%";
      const header = simulated
        ? `🧪 *Dry-Run ${category} Triggered!*`
        : txHash
        ? `🤖 *${category} Buy Executed!*`
        : `⚠️ *${category} Attempt Failed*`;
      const msg =
        `${header}\n` +
        `• *Token:* [${mint}](https://birdeye.so/token/${mint})\n` +
        `• *Amount:* ${amountFmt}\n` +
        `• *Impact:* ${impactFmt}\n` +
        (simulated
          ? "• *Simulated:* ✅"
          : txHash
          ? `• *Tx:* [↗️ View](https://solscan.io/tx/${txHash})`
          : "");
      await sendAlert("ui", msg, category);
    } catch (e) {
      console.warn("Alert failed:", e.message);
    }

    /* Ghost mode */
    if (txHash && ghostMode && coverWalletId) {
      try {
        const coverRow = await prisma.wallet.findUnique({
          where: { id: coverWalletId },
          select: { publicKey: true },
        });
        if (coverRow?.publicKey) {
          const dest = new PublicKey(coverRow.publicKey);
          const amt = BigInt(sizedQuote.outAmount);
          await forwardTokens(
            connPost,
            sizedQuote.outputMint,
            wallet,
            dest,
            amt
          );
        }
      } catch (e) {
        console.warn("Ghost forward failed:", e.message);
      }
    }

    /* Auto-rug detection */
    if (txHash && autoRug) {
      try {
        const freezeAuth = await checkFreezeAuthority(
          connPost,
          sizedQuote.outputMint
        );
        if (freezeAuth) {
          console.warn(
            `🚨 Honeypot detected (freezeAuthority: ${freezeAuth})`
          );
          const sellQuote = await getWarmQuote({
            inputMint: sizedQuote.outputMint,
            outputMint: sizedQuote.inputMint,
            amount: String(sizedQuote.outAmount),
            slippage: slippage || 5.0,
          });
          if (sellQuote) {
            await executeSwapTurbo({
              quote: sellQuote,
              wallet,
              shared,
              priorityFee: undefined,
              briberyAmount: undefined,
              privateRpcUrl: currentRpcUrl,
              skipPreflight,
            });
          }
        }
      } catch (e) {
        console.warn("Auto-rug failed:", e.message);
      }
    }

    /* Post-trade chain (TP/Trail/Alerts) */
    if (txHash && postTx && Array.isArray(postTx.chain) && postTx.chain.length) {
      try {
        postTradeQueue.enqueue({
          chain: postTx.chain,
          mint,
          userId,
          walletId,
          meta: {
            strategy,
            category,
            tpLadder: meta.tpLadder,
            tpPercent,
            slPercent,
            trailingStopPct: meta.trailingStopPct,
          },
        });
        postTradeQueue.process().catch(() => {});
      } catch (e) {
        console.warn('tradeExecutorTurbo: post-trade queue enqueue failed', e.message);
      }
    }

    /* Post-buy watcher */
    if (txHash && postBuyWatch) {
      // Extract watcher options; include optional rugDelayBlocks
      const {
        durationSec = 180,
        lpPullExit = true,
        authorityFlipExit = true,
        rugDelayBlocks = 0,
      } = postBuyWatch;
      const startTime = Date.now();
      const endTime = startTime + Math.max(0, durationSec) * 1000;
      const intervalMs = 5000;
      const sellInputMint = sizedQuote.outputMint;
      const sellOutputMint = sizedQuote.inputMint;
      const sellAmount = sizedQuote.outAmount;
      let active = true;
      // Convert rug delay blocks into milliseconds.  Each Solana slot is ~400 ms; adjust if scheduler provides better estimate
      const delayMs = Math.max(0, Number(rugDelayBlocks) || 0) * 400;
      /**
       * Perform a delayed exit.  If rugDelayBlocks > 0 this waits before submitting
       * the sell transaction to give the pool time to potentially recover.  The
       * provided quote must still be refreshed immediately before submit.
       */
      async function executeDelayedExit(exitQuote) {
        if (!exitQuote) return;
        try {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          await executeSwapTurbo({
            quote: exitQuote,
            wallet,
            shared,
            priorityFee: undefined,
            briberyAmount: undefined,
            privateRpcUrl: currentRpcUrl,
            skipPreflight,
          });
        } catch { /* ignore */ }
      }
      const intervalId = setInterval(async () => {
        if (!active || Date.now() > endTime) {
          clearInterval(intervalId);
          return;
        }
        try {
          // LP pull: if quote fails or output drastically smaller, exit
          if (lpPullExit) {
            const sq = await getWarmQuote({
              inputMint: sellInputMint,
              outputMint: sellOutputMint,
              amount: String(sellAmount),
              slippage: 5.0,
            });
            const outAmt = sq?.outAmount ? BigInt(sq.outAmount) : null;
            if (!sq || outAmt === null || outAmt < BigInt(sellAmount) / 2n) {
              await executeDelayedExit(sq);
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Authority flip: sell if freeze authority returns
          if (authorityFlipExit) {
            const freeze = await checkFreezeAuthority(connPost, sellInputMint);
            if (freeze) {
              const exitQuote = await getWarmQuote({
                inputMint: sellInputMint,
                outputMint: sellOutputMint,
                amount: String(sellAmount),
                slippage: 5.0,
              });
              await executeDelayedExit(exitQuote);
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
        } catch (e) {
          console.warn('post-buy watch error:', e.message);
        }
      }, intervalMs);
    }
  })().catch(console.error);

  /* ——— 5️⃣  Done ——— */
  return txHash;
}

/*
 * ---------------------------------------------------------------------------
 * Public API
 *
 * Historically this module exported a single async function which, when
 * `require`‑d, returned a bare function.  Some calling code (including the
 * Turbo Sniper orchestrator and accompanying tests) were instantiating it via
 * `new TradeExecutorTurbo()` and then invoking `.executeTrade(...)`.  However,
 * asynchronous functions cannot be used as constructors, so calling `new` on
 * the exported function resulted in a `TypeError`.  To maintain backwards
 * compatibility while supporting the `new` constructor pattern, we wrap the
 * core executor in a thin class.  The class exposes an `executeTrade()`
 * instance method which internally performs a safe quote, constructs the
 * required meta object and delegates to the original `execTrade()` helper.
 *
 * The static `execTrade` export is preserved for advanced callers that wish
 * to bypass the wrapper and supply their own quote and meta objects.  This
 * dual‑export design ensures that existing consumers continue to work
 * unchanged while new code can rely on the more ergonomic class interface.
 */

const { getSafeQuote } = require('./quoteHelper');

class TradeExecutorTurbo {
  /**
   * Construct a new TradeExecutorTurbo wrapper.
   *
   * @param {Object} opts
   * @param {Connection} [opts.connection] Optional Solana connection.  The
   *   underlying executor will create its own connections as needed; this
   *   parameter is retained for interface completeness but is not currently
   *   passed down into the hot path to avoid coupling.
   * @param {string} [opts.validatorIdentity] The validator identity used for
   *   leader scheduling.  When present it is forwarded into the meta on each
   *   call to `executeTrade()`.
   */
  constructor({ connection, validatorIdentity } = {}) {
    this.connection = connection;
    this.validatorIdentity = validatorIdentity;
    this.coreIdem = new CoreIdemStore(
      { ttlSec: Number(process.env.IDEMPOTENCY_TTL_SEC) || 90,
        salt: process.env.IDEMPOTENCY_SALT || '',
        resumeFromLast: true },
      { increment: () => {} }
    );
  }

  /**
   * Execute a trade given user context, basic trade parameters and optional
   * configuration.  This helper performs a safe quote using Jupiter's lite
   * API, merges the provided configuration into the meta object and then
   * calls the underlying `execTrade` function.  It intentionally avoids
   * pulling in any database, logging or safety check logic to keep the
   * latency as low as possible.
   */
  async executeTrade(userCtx, tradeParams, cfg = {}) {
    if (!userCtx || !userCtx.userId || !userCtx.walletId) {
      throw new Error('userCtx must include userId and walletId');
    }
    const { inputMint, outputMint, amount, slippage } = tradeParams || {};
    if (!inputMint || !outputMint || !amount) {
      throw new Error('tradeParams must include inputMint, outputMint and amount');
    }

    // ── Pre‑quote risk passes ──────────────────────────────────────────────
    // Before fetching a quote we run the hot‑path risk checks.  Only
    // developer/creator heuristics are exercised here – price/volume/mcap
    // filters are disabled by setting thresholds to zero/null.  We also
    // override fetchOverview with a constant stub to avoid unnecessary API
    // calls.  If passes() returns { ok: false } the token is blocked and
    // quoting is skipped entirely.  A structured response is returned to
    // callers with the reason and detail.  Metrics are bumped via the
    // inc() helper to surface overall block counts by reason.  Any
    // unexpected exceptions from passes() are caught and treated as
    // soft‑fails (i.e. quoting proceeds) to avoid false negatives.
    if (cfg?.devWatch) {
      try {
        const riskRes = await passes(outputMint, {
          entryThreshold: 0,
          volumeThresholdUSD: 0,
          dipThreshold: 0,
          limitUsd: null,
          minMarketCap: null,
          maxMarketCap: null,
          devWatch: cfg.devWatch,
          // Provide a dummy overview to satisfy the contract.  The values
          // chosen are arbitrary but must satisfy the zero thresholds above.
          fetchOverview: async () => ({
            price: 1,
            priceChange: 1,
            volumeUSD: 1,
            marketCap: 1,
          }),
        });
        if (!riskRes.ok) {
          // Record a generic block metric keyed by the underlying reason (detail
          // may be undefined for some reasons).  Note that more specific
          // metrics (e.g. holders_conc_exceeded_total) are already
          // incremented inside passes().
          const lbl = riskRes.detail || riskRes.reason || 'unknown';
          inc('prequote_block_total', 1, { reason: lbl });
          return { blocked: true, reason: riskRes.reason, detail: riskRes.detail };
        }
      } catch (_) {
        // Soft‑fail: if passes() throws, ignore and proceed to quote
      }
    }

    const safeQuoteRes = await getSafeQuote({ inputMint, outputMint, amount, slippage });
    if (!safeQuoteRes.ok) {
      throw new Error(`quote-failed: ${safeQuoteRes.reason || 'unknown'}`);
    }
    const quote = safeQuoteRes.quote;
    const meta = Object.assign({}, cfg, {
      userId: userCtx.userId,
      walletId: userCtx.walletId,
      slippage: slippage,
      validatorIdentity: this.validatorIdentity || cfg.validatorIdentity,
    });
    const simulated = Boolean(cfg.dryRun);
    return execTrade({ quote, mint: outputMint, meta, simulated });
  }

  async buildAndSubmit() {
    throw new Error('buildAndSubmit is not implemented on the wrapper');
  }
}

module.exports = TradeExecutorTurbo;
module.exports.execTrade = execTrade;