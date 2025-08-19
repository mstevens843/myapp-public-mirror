/**
 * turboTradeExecutor.js – Turbo-path trade executor (+ Execution Edges)
 * --------------------------------------------------------------------
 * • Arm-to-Trade envelope decryption (in-memory DEK)
 * • Ultra-fast swap via executeSwapTurbo() / executeSwapJitoBundle()
 * • Leader-timed send, warm quote cache, retry matrix, idempotency TTL
 * • NEW: Deterministic idempotency key + crash-safe resume window
 * • NEW: Liquidity-aware sizing (price impact / pool % / min USD)
 * • NEW: Probe buy then scale (fast two-step) with shared idKey
 * • NEW: Private relay/shadow mempool (feature-flag) fire-and-forget
 *   (fastest ack wins)
 * • Post-trade side-effects (non-blocking):
 *     – TP/SL rule insert
 *     – Telegram alert
 *     – Ghost-mode forwarding
 *     – Auto-rug check & exit
 * • UPDATE (this PR):
 *     – Initialize blockhash prewarm on strategy start; use cached blockhash during build
 *     – Add getPriorityFee() combining autoPriorityFee + cuPriceMicroLamportsMin/Max + priorityFeeLamports
 *     – Wire Jito tip if cfg.jitoTipLamports > 0
 *     – Support RPC quorum failover via RpcPool.sendRawTransactionQuorum() when cfg.rpcFailover=true
 *     – ADD: Dry-run short-circuit with simulated result (no network)
 *     – ADD: TP ladder + trailing stop metadata on result
 *     – ADD: per-mint coolOffMs window after failures
 *     – ADD: directAmmFirstPct split; smarter direct AMM fallback gating
 *     – ADD: optional idempotencyKey/idempotencyTtlMs dedupe (in-memory)
 */

'use strict';

const crypto = require('crypto');
const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Connection, PublicKey } = require("@solana/web3.js");

// Blockhash prewarm & cache
const { startBlockhashPrewarm, getCachedBlockhash } = require("../../execution/blockhashPrewarm");
// RPC quorum pool
const RpcPool = require("../../execution/rpcPool");

// Smarter AMM fallback guard
const { shouldDirectAmmFallback } = require("../../../utils/ammFallbackGuard");

// In-memory cool-off and ad-hoc idem cache (optional)
const _coolOffByMint = Object.create(null);
/** idempotencyKey -> { res:any, exp?:number } */
const _idemCache = new Map();


// --- Error classification (NET / USER / UNKNOWN) ---
const NET_ERRS  = [
  /blockhash/i, /node is behind/i, /timed? out/i, /connection/i,
  /getblockheight timed out/i, /account in use/i,
  /429|too many requests|rate limit/i               // NEW: RPC 429
];
const USER_ERRS = [
  /slippage/i, /insufficient funds/i, /mint.*not found/i, /slippage exceeded/i,
  /insufficient liquidity|not enough liquidity/i    // NEW: pool illiquidity
];

// Dev failure injector (safe no-op if module missing)
let devInject = { 
  maybe: async () => {}, 
  maybeThrow: () => {}, 
  maybeStaleBlockhash: () => false,
  tag: (/* kind, labels */) => {}
};
try { devInject = require("../../dev/failureInjector"); } catch (_) {}


function classifyError(msg = '') {
  const lower = String(msg).toLowerCase();
  if (USER_ERRS.some(r => r.test(lower))) return 'USER';
  if (NET_ERRS.some(r => r.test(lower)))  return 'NET';
  return 'UNKNOWN';
}

const RETRY_PLAN = {
  NET:     { refreshQuote: true, rotateRpcAt: 4, switchRouteAt: 3, bumpFee: true },
  UNKNOWN: { refreshQuote: true, rotateRpcAt: Infinity, switchRouteAt: Infinity, bumpFee: false },
  USER:    { refreshQuote: false, rotateRpcAt: Infinity, switchRouteAt: Infinity, bumpFee: false },
};


// ── ultra-light kill switch ──
let __KILLED = String(process.env.KILL_SWITCH || '').trim() === '1'; // NEW: env bootstrap
function setKill(v) { __KILLED = !!v; }
function requireAlive() { if (__KILLED) { const e = new Error('KILL_SWITCH_ACTIVE'); e.code='KILL'; throw e; }}

// ── per-minute token bucket ──
const __BUCKET = new Map(); // key -> {ts, used}
function takeBudget(key, units, limitPerMin) {
  if (!limitPerMin) return true;
  const now = Date.now();
  let b = __BUCKET.get(key);
  if (!b || now - b.ts > 60_000) b = { ts: now, used: 0 };
  if (b.used + units > limitPerMin) return false;
  b.used += units; b.ts = now; __BUCKET.set(key, b); return true;
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

//  Existing infra
const LeaderScheduler = require("./leaderScheduler");
const QuoteWarmCache  = require("./quoteWarmCache");

// Additional helpers for Turbo enhancements
const JitoFeeController = require("./jitoFeeController");
const { directSwap } = require("./raydiumDirect");
const metricsLogger = require("../logging/metrics"); // keep preexisting metrics

// Import new parallel filler (Prompt 5)
const { parallelFiller } = require('./parallelFiller');

// ── Risk gating
const { passes } = require('./passes');
const idempotencyStore = require("../../../utils/idempotencyStore"); // existing in your repo (short-TTL cache)

//  NEW core modules added by Prompt 1 (shadow mempool + deterministic idempotency + sizing + probe)
const RelayClient = require('./relayClient');                 // new abstraction (feature-flag)
const CoreIdemStore = require('./idempotencyStore');                 // crash-safe resume window (disk-backed)
const { sizeTrade } = require('./liquiditySizer');                   // liquidity-aware sizing
// const { performProbe } = require('./probeBuyer');                    // micro-buy then scale

// 🔁 Unified resolver for protected/unprotected wallets
const { getKeypairForTrade } = require("../../../armEncryption/resolveKeypair");
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

//   Ghost utilities
const {
  forwardTokens,
  checkFreezeAuthority,
} = require("./ghost");

// 🔹 NEW imports from the simplified executor
const { assertMinLiquidity } = require('./liquidityGate');
const { recordTradeClosed, recordExitReason } = require('../../../middleware/metrics');

// (Legacy placeholder kept for back-compat; no longer used when RpcPool is configured)
// const RpcQuorumClient = require('./rpcQuorumClient');

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
function observe(name, arg1, arg2) {
  try {
    if (typeof metricsLogger.observe === 'function') {
      if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
        metricsLogger.observe(name, arg2, arg1);
      } else {
        metricsLogger.observe(name, arg1, arg2 || {});
      }
    }
  } catch (_) {}
}

/**
 * Redact secrets or PII for logs/metrics.
 */
function _redact(key) {
  const s = String(key || '');
  if (!s) return s;
  if (s.length <= 4) return s;
  return `******${s.slice(-4)}`;
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
 *  Arm-aware key loader (delegates to unified resolver)
 * ──────────────────────────────────────────── */
async function loadWalletKeypairArmAware(userId, walletId) {
  return getKeypairForTrade(userId, walletId);
}

/* ──────────────────────────────────────────────
 *  Priority fee helper
 * ──────────────────────────────────────────── */
/**
 * Combine autoPriorityFee and explicit min/max/override settings to derive
 * a compute unit price in microLamports. Also returns any configured Jito
 * tip (lamports).
 */
function getPriorityFee(cfg = {}, attempt = 0, bumps = {}) {
  const auto = !!cfg.autoPriorityFee;
  const min = Number(cfg.cuPriceMicroLamportsMin ?? 0) || 0;
  const max = Number(cfg.cuPriceMicroLamportsMax ?? min) || min;
  let cuMicro = 0;
  let tipLamports = Math.max(0, Number(cfg.jitoTipLamports || 0) || 0);
  if (auto) {
    if (max > min) {
      const steps = 3;
      const step = Math.ceil((max - min) / steps);
      cuMicro = Math.min(max, min + attempt * step);
    } else {
      cuMicro = min;
    }
  } else {
    const baseCu = Number(cfg.priorityFeeLamports || 0) || 0; // microLamports
    const cuBump = Math.max(0, Number(bumps.bumpCuStep || 0)) * attempt;
    cuMicro = baseCu + cuBump;
    tipLamports += Math.max(0, Number(bumps.bumpTipStep || 0)) * attempt;
  }
  return { computeUnitPriceMicroLamports: Math.max(0, Math.floor(cuMicro)), tipLamports };
}

/* ──────────────────────────────────────────────
 *  Private relay helper
 * ──────────────────────────────────────────── */
function startPrivateRelayIfEnabled({ privateRelay, walletPubkey, mint, idKey, amount }) {
  if (!privateRelay || !privateRelay.enabled) return { ack: Promise.resolve(null) };
  const client = new RelayClient(privateRelay, { increment: inc });
  const payload = { walletPublicKey: walletPubkey, mint, idKey, amount };
  const ack = client.send(payload); // fire-and-forget
  return { client, ack };
}

/* ──────────────────────────────────────────────
 *  Warm Quote Cache (as before)
 * ──────────────────────────────────────────── */
async function applyLiquiditySizing({ baseQuote, sizingCfg,
  priceImpactEstimator, refreshQuote }) {
  if (!sizingCfg) return baseQuote;
  const poolReserves = Number(baseQuote?.poolReserves) || null;
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
  return { ...baseQuote, inAmount: String(finalAmount) };
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
    turboMode = true,
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
    autoPriorityFee,

    // NEW: retry + ttl
    quoteTtlMs = 600,
    retryPolicy = { max: 3, bumpCuStep: 2000, bumpTipStep: 1000, routeSwitch: true, rpcFailover: true },
    rpcQuorum = 1,
    rpcMaxFanout,
    rpcStaggerMs = 50,
    rpcTimeoutMs = 10_000,

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

    // RPC failover support
    rpcFailover,
    rpcEndpoints,

    // ——— ADDED (Strategy Finishing Pack) ———
    dryRun = false,
    tpLadder,
    trailingStopPct,
    coolOffMs = 0,
    directAmmFirstPct,
    quoteLatencyMs,
    poolFresh = true,
    volatilityPct,
    maxVolatilityPct,
    idempotencyKey,
    idempotencyTtlMs,
    slippagePct,
    maxSlippagePct,
    forceFail,
    fallbackQuoteLatencyMs,
    expectedSlipBoundPct,
    poolAgeMs,
    poolFreshnessTtlMs,
    quoteLatencyThresholdMs,
  } = meta;

   let _lastFee = { priority: undefined, tip: undefined };

  if (autoPriorityFee && cuPriceMicroLamportsMax && cuPriceMicroLamportsMin &&
    cuPriceMicroLamportsMax < cuPriceMicroLamportsMin) {
    throw new Error('invalid CU price range: max < min');
  }
  if (rpcQuorum && rpcMaxFanout && rpcQuorum > rpcMaxFanout) {
    throw new Error('invalid quorum: quorum > maxFanout');
  }

  // --- Hot path metrics instrumentation ---
  const _hotStart = Date.now();
  let _quoteStart = Date.now();
  let _buildStart = null;
  let _recordedTotal = false;
  const _recordTotal = (cls = 'NONE') => {
    if (_recordedTotal) return;
    _recordedTotal = true;
    try { observe('hotpath_ms', Date.now() - _hotStart, { stage: 'total', strategy: 'turbo' }); } catch (_) {}
    try { inc('submit_result_total', 1, { errorClass: cls, strategy: 'turbo' }); } catch (_) {}
  };

  if (!_coreIdemInited) {
    await coreIdem.init().catch(() => {});
    _coreIdemInited = true;
  }

  if (!userId || !walletId)
    throw new Error("userId and walletId are required in meta");

  // Optional ad-hoc idempotencyKey TTL dedupe (separate from stableIdKey)
  if (idempotencyKey) {
    const ent = _idemCache.get(idempotencyKey);
    if (ent) {
      if (!ent.exp || Date.now() < ent.exp) return ent.res;
      _idemCache.delete(idempotencyKey);
    }
  }

  // Per-mint cool-off gate (before loading keys)
  if (coolOffMs > 0 && _coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < coolOffMs) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

  // Simulated slippage guard and forced failure (pre-swap)
  if (typeof maxSlippagePct === 'number' && typeof slippagePct === 'number' && slippagePct > maxSlippagePct) {
    _coolOffByMint[mint] = Date.now();
    throw new Error(`slippage ${slippagePct} exceeds max ${maxSlippagePct}`);
  }
  if (forceFail) {
    _coolOffByMint[mint] = Date.now();
    throw new Error('forced failure');
  }

  const wallet = await loadWalletKeypairArmAware(userId, walletId);
  // kill switch & budget guard (invisible to user)
  requireAlive();
  const notionalUsd = Number(meta?.notionalUsd || 0);
  const perMinCap  = Number(meta?.limits?.perMinuteUsd || 0);
  const bucketKey  = `${userId}:${walletId}`;
  if (!takeBudget(bucketKey, Math.max(0, notionalUsd), perMinCap)) {
    const e = new Error('BUDGET_EXCEEDED');
    e.code = 'BUDGET';
    throw e;
  }

  // pick RPC for this attempt
  let currentRpcUrl = privateRpcUrl || process.env.PRIVATE_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL;
  let conn = new Connection(currentRpcUrl, 'confirmed');

  // start/refresh blockhash prewarm on first use
  try { ensurePrewarm(conn); } catch (_) {}

  // RpcPool for failover/quorum
  let rpcPool = null;
  let endpoints = [];
  if (Array.isArray(rpcEndpoints) && rpcEndpoints.length) {
    endpoints = rpcEndpoints.filter(Boolean);
  } else if (typeof rpcEndpoints === 'string' && rpcEndpoints.trim()) {
    endpoints = rpcEndpoints.split(',').map(s => s.trim()).filter(Boolean);
  }
  if ((rpcFailover || Number(rpcQuorum) > 1) && endpoints.length >= 1) {
    rpcPool = new RpcPool(endpoints, metricsLogger);
  }

  // helper: refresh recent blockhash on primary (pre-send)
  async function _preSendRefresh() {
    try {
      const c = getCachedBlockhash?.();
      // if prewarmer exposed expiry, honor it; else assume it’s fresh enough
      if (c && (c.expiresAtMs ? c.expiresAtMs > Date.now() : true)) return;
      await conn.getLatestBlockhash('confirmed');
      metricsLogger.recordBlockhashRefresh?.(conn._rpcEndpoint || 'primary');
    } catch (_) {}
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
      }
    } catch (_) {}
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
  const shared = mevMode === "secure";
  const basePriorityFeeLamports = toNum(priorityFeeLamports) ?? toNum(prefs?.defaultPriorityFee) ?? 0;

  // ── Deterministic idKey
  const idemSalt = idempotency?.salt ?? process.env.IDEMPOTENCY_SALT ?? '';
  const slotBucket = idempotency?.slotBucket ?? meta.slotBucket ?? '';
  const stableIdKey =
    meta.idempotencyKey ||
    crypto.createHash('sha256').update([userId, walletId, mint, quote?.inAmount ?? '', slotBucket, idemSalt].join('|')).digest('hex');

  const ttlSec = Number(idempotency?.ttlSec ?? 60);
  if (!idTtlCheckAndSet(stableIdKey, ttlSec)) {
    const cached = idempotencyStore.get(stableIdKey) || (await coreIdem.get?.(stableIdKey));
    if (cached) return cached;
    inc('idempotency_blocked_total', 1);
    throw new Error('duplicate attempt blocked');
  }
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
      allowedDexes: Array.isArray(allowedDexes) ? allowedDexes.join(',') : String(allowedDexes || ''),
      excludedDexes: Array.isArray(excludedDexes) ? excludedDexes.join(',') : String(excludedDexes || ''),
      splitTrade: !!splitTrade,
    };
    const cached = quoteCache.get(key);
    if (cached) return cached;
    const t0 = Date.now();
    await devInject.maybe('aggregator_500');
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

  try {
    const _quoteDuration = Date.now() - _quoteStart;
    observe('hotpath_ms', _quoteDuration, { stage: 'quote', strategy: 'turbo' });
  } catch (_) {}

  if (!sizedQuote) throw new Error('sizing/quote unavailable');

  // --- Dry-run short-circuit (no network) ---
  const isDryRun = simulated || Boolean(dryRun);
  if (isDryRun) {
    const expectedSlipPct =
      ((sizedQuote?.priceImpactPct ?? quote?.priceImpactPct ?? 0) * 100);

    const usedDirect = !!(directAmmFallback && shouldDirectAmmFallback({
      // staleness
      quoteAgeMs: quoteLatencyMs,
      quoteLatencyThresholdMs: quoteLatencyThresholdMs || fallbackQuoteLatencyMs, // prefer new knob
      fallbackQuoteLatencyMs, // keep legacy

      // freshness
      poolAgeMs,
      poolFreshnessTtlMs,
      poolFresh,

      // slip bound
      expectedSlipPct,
      expectedSlipBoundPct,

      // volatility gate (unchanged)
      volatilityPct,
      maxVolatilityPct,
    }));

    if (usedDirect) inc('direct_fallback_chosen_total', 1);

    const parseLadder = (v) => {
      if (!v) return [];
      const arr = Array.isArray(v) ? v : String(v).split(',').map(s => Number(s.trim()));
      return arr.filter(n => Number.isFinite(n) && n > 0);
    };
    const ladder = parseLadder(tpLadder);

    const pct = Number(directAmmFirstPct);
    const legs = (Number.isFinite(pct) && pct > 0 && pct < 100)
      ? [{ pct, route: 'direct' }, { pct: 100 - pct, route: 'router' }]
      : [];

    const baseTx = (p) => `${p || 'sim'}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const sim = { simulated: true, tx: baseTx('sim'), usedDirect };
    if (ladder.length) sim.exits = ladder.map(p => ({ pct: p, tx: baseTx('sim_exit') }));
    if (legs.length) sim.legs = legs;
    if (typeof trailingStopPct === 'number' && trailingStopPct > 0) sim.trailingStopPct = trailingStopPct;

    if (idempotencyKey) {
      const exp = idempotencyTtlMs ? Date.now() + Number(idempotencyTtlMs) : undefined;
      _idemCache.set(idempotencyKey, { res: sim, exp });
    }
    return sim;
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

  // Create an override sender using RpcPool when configured
  const sendRawOverride = rpcPool
    ? async (rawTx, sendOpts) =>
        rpcPool.sendRawTransactionQuorum(rawTx, {
          quorum: rpcQuorum,
          maxFanout: rpcMaxFanout,
          staggerMs: rpcStaggerMs,
          timeoutMs: rpcTimeoutMs,
          ...(sendOpts || {}),
        })
    : null;

  // Sender
  async function sendOnce(localQuote) {
    let txHash = null;
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(retryPolicy?.max ?? 3));
    let jitoMode = !!useJitoBundle;
    let usedDirect = false;
    let lastErrClass = 'NONE';

    // Pre-send blockhash prewarm for first attempt
    await _preSendRefresh();

    // Split-first: direct AMM for a percentage, remainder via router
    const firstPct = Number(directAmmFirstPct);
    if (Number.isFinite(firstPct) && firstPct > 0 && firstPct < 100) {
      try {
        const totalIn = Math.max(0, Number(localQuote.inAmount) || 0);
        const dirAmt = Math.floor((totalIn * firstPct) / 100);
        if (dirAmt > 0) {
          const dirQuote = await getWarmQuote({
            inputMint: localQuote.inputMint,
            outputMint: localQuote.outputMint,
            amount: String(dirAmt),
            slippage: effSlippage,
          });
          await _preSendRefresh();
          const startSlot = await conn.getSlot();
          const directTx = await directSwap({
            wallet,
            inputMint: dirQuote.inputMint,
            outputMint: dirQuote.outputMint,
            amount: String(dirQuote.inAmount),
            slippage: effSlippage,
            privateRpcUrl: currentRpcUrl,
            skipPreflight,
            sendRawTransaction: sendRawOverride,
            broadcastRawTransaction: sendRawOverride,
          });
          const endSlot = await conn.getSlot();
          if (directTx) {
            usedDirect = true;
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            try {
              trackPendingTrade(directTx, mint, strategy, {
                slot: endSlot, route: 'direct',
                cuUsed: null, cuPrice: undefined,
                tip: undefined, slippage: effSlippage, fillPct: firstPct,
              });
            } catch (_) {}
            // Refresh quote for remaining
            const rem = totalIn - dirAmt;
            if (rem > 0) {
              const remQuote = await getWarmQuote({
                inputMint: localQuote.inputMint,
                outputMint: localQuote.outputMint,
                amount: String(rem),
                slippage: effSlippage,
              });
              if (remQuote) localQuote = remQuote;
            } else {
              // All done via direct leg
              return directTx;
            }
          }
        }
      } catch (e) {
        metricsLogger.recordFail?.('direct-first-fail');
      }
    }

    while (attempt < maxAttempts && !txHash) {
      try {
        // Also refresh before each attempt
        await _preSendRefresh();

        // Prepare cached blockhash (best-effort)
        const cached = getCachedBlockhash();
        const blockhashOpts = cached
          ? { recentBlockhash: cached.blockhash, blockhash: cached.blockhash, lastValidBlockHeight: cached.lastValidBlockHeight }
          : {};

        // Compute priority fee & tip for this attempt
        const pf = getPriorityFee({
          autoPriorityFee,
          cuPriceMicroLamportsMin,
          cuPriceMicroLamportsMax,
          priorityFeeLamports: basePriorityFeeLamports,
          jitoTipLamports,
        }, (lastErrClass === 'NET') ? attempt : 0, retryPolicy);

        // Direct AMM fallback when quote is stale, pool fresh, slip within bound
        if (!usedDirect && directAmmFallback && attempt === 0) {
          const expectedSlipPct =
            ((localQuote?.priceImpactPct ?? sizedQuote?.priceImpactPct ?? 0) * 100);

          const doFallback = shouldDirectAmmFallback({
            quoteAgeMs: quoteLatencyMs,
            quoteLatencyThresholdMs: quoteLatencyThresholdMs || fallbackQuoteLatencyMs,
            fallbackQuoteLatencyMs,
            poolAgeMs,
            poolFreshnessTtlMs,
            poolFresh,
            expectedSlipPct,
            expectedSlipBoundPct,
            volatilityPct,
            maxVolatilityPct,
          });

          if (doFallback) {
            inc('direct_fallback_chosen_total', 1);

            // Dev: simulate pool illiquidity before direct leg
            devInject.maybeThrow('pool_illiquidity');

            const startSlot = await conn.getSlot();
            txHash = await directSwap({
              wallet,
              inputMint: localQuote.inputMint,
              outputMint: localQuote.outputMint,
              amount: String(localQuote.inAmount),
              slippage: effSlippage,
              privateRpcUrl: currentRpcUrl,
              skipPreflight,
              ...blockhashOpts,
              sendRawTransaction: sendRawOverride,
              broadcastRawTransaction: sendRawOverride,
            });
            const endSlot = await conn.getSlot();

            if (txHash) {
            // record the fees that actually got used
            _lastFee.priority = fees.computeUnitPriceMicroLamports;
            _lastFee.tip      = fees.tipLamports;
              inc('direct_fallback_ok_total', 1);
              metricsLogger.recordInclusion?.(endSlot - startSlot);
              metricsLogger.recordSuccess?.();
              usedDirect = true;
              const leadTime = meta && meta.detectedAt ? (Date.now() - meta.detectedAt) : null;
              try {
                trackPendingTrade(txHash, mint, strategy, {
                  slot: endSlot,
                  cuUsed: null,
                  cuPrice: pf.computeUnitPriceMicroLamports,
                  tip: pf.tipLamports,
                  route: 'direct',
                  slippage: effSlippage,
                  fillPct: null,
                  leadTime_ms: leadTime,
                });
              } catch (_) {}
              break;
            } else {
              inc('direct_fallback_fail_total', 1);
              metricsLogger.recordFail?.('direct-swap-fail');
            }
          }
        }

        // Choose path (Jito or Turbo)
        if (jitoMode) {
          // Jito with explicit tip and CU price
          const controller = new JitoFeeController({
            cuAdapt,
            cuPriceMicroLamportsMin,
            cuPriceMicroLamportsMax,
            cuPriceCurve: meta?.cuPriceCurve,
            tipCurveCoefficients: meta?.tipCurveCoefficients,
            tipCurve,
            baseTipLamports: pf.tipLamports, // wire configured tip
          });
          const fees = controller.getFee(attempt);
          const startSlot = await conn.getSlot();
          txHash = await executeSwapJitoBundle({
            quote: localQuote,
            wallet,
            shared,
            priorityFee: fees.computeUnitPriceMicroLamports,
            briberyAmount: fees.tipLamports,
            jitoRelayUrl,
            skipPreflight,
            ...blockhashOpts,
            sendRawTransaction: sendRawOverride,
            broadcastRawTransaction: sendRawOverride,
          });
          const endSlot = await conn.getSlot();
          if (txHash) {
            // record the fees that actually got used
            _lastFee.priority = pf.computeUnitPriceMicroLamports;
            _lastFee.tip      = pf.tipLamports;
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            metricsLogger.recordSuccess?.();
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
            priorityFee: pf.computeUnitPriceMicroLamports, // CU price (microLamports)
            briberyAmount: pf.tipLamports,                  // optional extra lamports
            privateRpcUrl: currentRpcUrl,
            skipPreflight,
            ...blockhashOpts,
            sendRawTransaction: sendRawOverride,
            broadcastRawTransaction: sendRawOverride,
          });
          const endSlot = await conn.getSlot();
          if (txHash) {
            metricsLogger.recordInclusion?.(endSlot - startSlot);
            metricsLogger.recordSuccess?.();
            const leadTime = meta && meta.detectedAt ? (Date.now() - meta.detectedAt) : null;
            try {
              trackPendingTrade(txHash, mint, strategy, {
                slot: endSlot,
                cuUsed: null,
                cuPrice: pf.computeUnitPriceMicroLamports,
                tip: pf.tipLamports,
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
        _coolOffByMint[mint] = Date.now();

        attempt += 1;
        const cls = classifyError(err?.message || err?.toString());
        lastErrClass = cls;

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

        const plan = RETRY_PLAN[cls] || RETRY_PLAN.UNKNOWN;
        // Hot account / contention backoff (tiny jitter)
        if (/account in use|already in use|busy/i.test(err?.message || '')) {
          await sleep(120 + Math.floor(Math.random()*180));
        }
        if (attempt === plan.switchRouteAt && retryPolicy.routeSwitch) {
          jitoMode = !jitoMode;
        }
        if (attempt >= plan.rotateRpcAt && retryPolicy.rpcFailover && endpoints.length > 1) {
          const idx = (endpoints.indexOf(currentRpcUrl) + 1) % endpoints.length;
          currentRpcUrl = endpoints[idx] || currentRpcUrl;
          conn = new Connection(currentRpcUrl, 'confirmed');
          try { ensurePrewarm(conn); } catch (_) {}
        }
        metricsLogger.recordRetry?.();

        // Refresh quote after changes
        try {
          await _preSendRefresh();
          // Dev: simulate stale blockhash (NET) & RPC 429 (NET)
          devInject.maybeThrow('stale_blockhash'); // e.g. throw new Error('blockhash not found')
          devInject.maybeThrow('rpc_429');         // e.g. throw new Error('429 Too Many Requests')

          const qRes = await getWarmQuote({
            inputMint: localQuote.inputMint,
            outputMint: localQuote.outputMint,
            amount: String(localQuote.inAmount),
            slippage: effSlippage,
          });
          if (qRes) localQuote = qRes;
        } catch (_) {}
      }
    }

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
    if (_buildStart === null) _buildStart = Date.now();
    let probeTx;
    try {
      probeTx = await sendOnce(probeQuote);
    } catch (err) {
      const cls = classifyError(err?.message || err?.toString());
      _recordTotal(cls);
      throw err;
    }

    const liveImpactPct = (probeQuote?.priceImpactPct ?? 0) * 100;
    if (probe.abortOnImpactPct != null && liveImpactPct > Number(probe.abortOnImpactPct)) {
      inc('probe_abort_total', 1);
      try { idempotencyStore.set(stableIdKey, probeTx || 'probe-aborted'); } catch {}
      _recordTotal('NONE');
      try {
        const _sendDuration = Date.now() - _buildStart;
        observe('hotpath_ms', _sendDuration, { stage: 'build', strategy: 'turbo' });
        observe('hotpath_ms', 0, { stage: 'sign', strategy: 'turbo' });
        observe('hotpath_ms', _sendDuration, { stage: 'submit', strategy: 'turbo' });
      } catch (_) {}
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
      _buildStart = Date.now();
      let scaleTx;
      try {
        scaleTx = await sendOnce(scaleQuote);
      } catch (err) {
        const cls = classifyError(err?.message || err?.toString());
        _recordTotal(cls);
        throw err;
      }
      txHash = scaleTx || probeTx || null;
      if (scaleTx) inc('probe_scale_success_total', 1);
    } else {
      txHash = probeTx || null;
      inc('probe_scale_success_total', 1);
    }
    try {
      const _sendDuration = Date.now() - _buildStart;
      observe('hotpath_ms', _sendDuration, { stage: 'build', strategy: 'turbo' });
      observe('hotpath_ms', 0, { stage: 'sign', strategy: 'turbo' });
      observe('hotpath_ms', _sendDuration, { stage: 'submit', strategy: 'turbo' });
    } catch (_) {}
  } else {
    await _preSendRefresh();
    _buildStart = Date.now();
    try {
      txHash = await sendOnce(sizedQuote);
    } catch (err) {
      const cls = classifyError(err?.message || err?.toString());
      _recordTotal(cls);
      throw err;
    }
    try {
      const _sendDuration = Date.now() - _buildStart;
      observe('hotpath_ms', _sendDuration, { stage: 'build', strategy: 'turbo' });
      observe('hotpath_ms', 0, { stage: 'sign', strategy: 'turbo' });
      observe('hotpath_ms', _sendDuration, { stage: 'submit', strategy: 'turbo' });
    } catch (_) {}
  }

  // Cache idempotency key on success
  if (!simulated && stableIdKey && txHash) {
    try { idempotencyStore.set(stableIdKey, txHash); } catch {}
    try { coreIdem.markSuccess?.(stableIdKey); } catch {}
  }
  if (idempotencyKey && txHash) {
    const exp = idempotencyTtlMs ? Date.now() + Number(idempotencyTtlMs) : undefined;
    _idemCache.set(idempotencyKey, { res: txHash, exp });
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
        priorityFee: _lastFee.priority,   // micro-lamports per CU
        briberyAmount: _lastFee.tip,  
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
        ? ` *Dry-Run ${category} Triggered!*`
        : txHash
        ? ` *${category} Buy Executed!*`
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
          const redactedFreeze = _redact(freezeAuth);
          console.warn(
            ` Honeypot detected (freezeAuthority: ${redactedFreeze})`
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
      // Destructure extended post-buy watcher config.  In addition to
      // the classic LP pull and authority flip exits we now support
      // optional smart exit modes (time, volume, liquidity) and a rug
      // delay measured in blocks.  All numeric values are converted
      // up-front to avoid repeated parsing during the interval loop.
      const {
        durationSec = 180,
        lpPullExit = true,
        authorityFlipExit = true,
        rugDelayBlocks = 0,
        smartExitMode = null,
        smartExit = {},
      } = postBuyWatch;

      const { time: smartTime = {}, volume: smartVolume = {}, liquidity: smartLiquidity = {} } = smartExit;
      const maxHoldSec = smartTime.maxHoldSec != null ? +smartTime.maxHoldSec : null;
      const minPnLBeforeTimeExitPct = smartTime.minPnLBeforeTimeExitPct != null ? +smartTime.minPnLBeforeTimeExitPct : null;
      const volWindowSec = smartVolume.volWindowSec != null ? +smartVolume.volWindowSec : null;
      const volDropPct  = smartVolume.volDropPct != null ? +smartVolume.volDropPct : null;
      const lpOutflowExitPct = smartLiquidity.lpOutflowExitPct != null ? +smartLiquidity.lpOutflowExitPct : null;

      const startTime = Date.now();
      const endTime = startTime + Math.max(0, durationSec) * 1000;
      // If a time-based smart exit is configured we compute its
      // independent timeout.  Otherwise it remains null and is
      // ignored.
      const smartTimeEnd = maxHoldSec != null ? startTime + Math.max(0, maxHoldSec) * 1000 : null;
      // Track the maximum observed sell quote for volume based exits.
      let maxOutObserved = null;
      let lastVolWindowTs = Date.now();

      const intervalMs = 5000;
      const sellInputMint = sizedQuote.outputMint;
      const sellOutputMint = sizedQuote.inputMint;
      const sellAmount = sizedQuote.outAmount;
      let active = true;
      // Convert sellAmount (string/number) into a BigInt baseline for
      // relative comparisons in liquidity and volume exits.  Fallback to
      // zero on parse failure.
      const initialOutAmount = (() => {
        try { return BigInt(sellAmount); } catch { return 0n; };
      })();
      const delayMs = Math.max(0, Number(rugDelayBlocks) || 0) * 400;
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
        const now = Date.now();
        // Bail out if watcher is no longer active or the global duration
        // expired.  The durationSec guard remains in place to avoid
        // indefinite looping when no exits fire.
        if (!active || now > endTime) {
          clearInterval(intervalId);
          return;
        }
        try {
          // Always attempt to fetch a warm quote when any exit is
          // configured that depends on pricing.  This includes lpPull,
          // volume, liquidity and time PnL exits.  Warm quote returns
          // null on failure so downstream checks must handle null.
          let sq = null;
          let currentOut = null;
          const needsQuote = lpPullExit || smartExitMode === 'time' || smartExitMode === 'volume' || smartExitMode === 'liquidity';
          if (needsQuote) {
            sq = await getWarmQuote({
              inputMint: sellInputMint,
              outputMint: sellOutputMint,
              amount: String(sellAmount),
              slippage: 5.0,
            });
            if (sq && sq.outAmount != null) {
              try { currentOut = BigInt(sq.outAmount); } catch { currentOut = null; }
            }
          }
          // LP pull exit: sell when current output is less than half
          // of our original output amount.  This protects against
          // sudden liquidity drains.  Only runs when enabled.
          if (lpPullExit) {
            if (!sq || currentOut === null || currentOut < (initialOutAmount / 2n)) {
              // 🔹 metrics from simplified executor
              try { recordExitReason('lp-pull'); recordTradeClosed(); } catch (_) {}
              await executeDelayedExit(sq);
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Authority flip exit: if freeze authority flips we exit.
          if (authorityFlipExit) {
            const freeze = await checkFreezeAuthority(connPost, sellInputMint);
            if (freeze) {
              // 🔹 metrics from simplified executor
              try { recordExitReason('authority-flip'); recordTradeClosed(); } catch (_) {}
              const exitQuote = sq || await getWarmQuote({
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
          // Smart exit: time based
          if (smartExitMode === 'time' && smartTimeEnd != null && now >= smartTimeEnd) {
            // If no PnL threshold is provided or we cannot compute
            // currentOut, exit immediately.  Otherwise compute PnL and
            // require that it meets the minimum before exiting.
            let shouldExit = false;
            if (minPnLBeforeTimeExitPct == null || currentOut === null) {
              shouldExit = true;
            } else {
              try {
                const diff = currentOut - initialOutAmount;
                // When diff is negative this yields a negative PnL
                const pnlPct = Number(diff) * 100 / Number(initialOutAmount);
                if (pnlPct >= minPnLBeforeTimeExitPct) shouldExit = true;
              } catch { shouldExit = true; }
            }
            if (shouldExit) {
              // 🔹 metrics from simplified executor
              try { recordExitReason('smart-time'); recordTradeClosed(); } catch (_) {}
              await executeDelayedExit(sq);
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Smart exit: volume based
          if (smartExitMode === 'volume' && volWindowSec != null && volDropPct != null && currentOut !== null) {
            // Initialize maxOutObserved on the first iteration
            if (maxOutObserved === null) {
              maxOutObserved = currentOut;
              lastVolWindowTs = now;
            }
            // Reset maxOutObserved if the window expired
            if (now - lastVolWindowTs >= volWindowSec * 1000) {
              maxOutObserved = currentOut;
              lastVolWindowTs = now;
            }
            // Update maxOutObserved if current quote surpasses it
            if (currentOut > maxOutObserved) {
              maxOutObserved = currentOut;
            }
            // Compute percentage drop from the peak to current
            const drop = maxOutObserved > 0n ? (Number(maxOutObserved - currentOut) * 100) / Number(maxOutObserved) : 0;
            if (drop >= volDropPct) {
              // 🔹 metrics from simplified executor
              try { recordExitReason('smart-volume'); recordTradeClosed(); } catch (_) {}
              await executeDelayedExit(sq);
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Smart exit: liquidity based
          if (smartExitMode === 'liquidity' && lpOutflowExitPct != null && currentOut !== null) {
            const drop = initialOutAmount > 0n ? (Number(initialOutAmount - currentOut) * 100) / Number(initialOutAmount) : 0;
            if (drop >= lpOutflowExitPct) {
              // 🔹 metrics from simplified executor
              try { recordExitReason('smart-liquidity'); recordTradeClosed(); } catch (_) {}
              await executeDelayedExit(sq);
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

  _recordTotal('NONE');
  return txHash;
}

/* ──────────────────────────────────────────────
 *  Prewarm initialization helper (singleton)
 * ──────────────────────────────────────────── */
let _prewarmStarted = false;
let _prewarmStop = null;
function ensurePrewarm(connection) {
  if (_prewarmStarted) return;
  try {
    const handle = startBlockhashPrewarm({ connection, intervalMs: 400, ttlMs: 1200 });
    _prewarmStop = handle && typeof handle.stop === 'function' ? handle.stop : null;
    _prewarmStarted = true;
  } catch (_) {
    // ignore
  }
}



// ── housekeeping + shutdown ──
let _sweeper = null;
function startSweeper() {
  if (_sweeper) return;
  _sweeper = setInterval(() => {
    const now = Date.now();

    // expire id TTLs
    for (const [k, exp] of _idTtlGate.entries()) {
      if (exp <= now) _idTtlGate.delete(k);
    }

    // expire per-minute token bucket entries (>2min old)
    for (const [k, v] of __BUCKET.entries()) {
      if (!v || now - v.ts > 120_000) __BUCKET.delete(k);
    }

    // coolOff map: clear entries older than 10 minutes
    for (const [m, ts] of Object.entries(_coolOffByMint)) {
      if (now - ts > 10 * 60_000) delete _coolOffByMint[m];
    }

    // quote caches are self-evicting; nothing to do here
    try { coreIdem.cleanupExpired?.(); } catch (_) {}
    // expire ad-hoc idempotency cache
    for (const [k, v] of _idemCache.entries()) {
      if (v && v.exp && v.exp <= now) _idemCache.delete(k);
    }
  }, 60_000);
}

function stopExecutorBackground() {
  if (_sweeper) { clearInterval(_sweeper); _sweeper = null; }
  try { _prewarmStop?.(); } catch (_) {}
}

(function _boot() {
  try { startSweeper(); } catch (_) {}
  try {
    process.once('SIGINT',  () => stopExecutorBackground());
    process.once('SIGTERM', () => stopExecutorBackground());
  } catch (_) {}
})();

/*
 * Public API wrapper class (unchanged aside from prewarm on construct)
 */
const { getSafeQuote } = require('./quoteHelper');

class TradeExecutorTurbo {
  constructor({ connection, validatorIdentity } = {}) {
    this.connection = connection;
    this.validatorIdentity = validatorIdentity;
    this.coreIdem = new CoreIdemStore(
      { ttlSec: Number(process.env.IDEMPOTENCY_TTL_SEC) || 90,
        salt: process.env.IDEMPOTENCY_SALT || '',
        resumeFromLast: true },
      { increment: () => {} }
    );
    // Start prewarm early using provided connection or default env RPC
    try {
      const conn = connection || new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
      ensurePrewarm(conn);
    } catch (_) {}
  }

  async executeTrade(userCtx, tradeParams, cfg = {}) {
    if (!userCtx || !userCtx.userId || !userCtx.walletId) {
      throw new Error('userCtx must include userId and walletId');
    }
    const { inputMint, outputMint, amount, slippage } = tradeParams || {};
    if (!inputMint || !outputMint || !amount) {
      throw new Error('tradeParams must include inputMint, outputMint and amount');
    }

    // Pre-quote risk passes
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
          fetchOverview: async () => ({
            price: 1, priceChange: 1, volumeUSD: 1, marketCap: 1,
          }),
        });
        if (!riskRes.ok) {
          const lbl = riskRes.detail || riskRes.reason || 'unknown';
          inc('prequote_block_total', 1, { reason: lbl });
          return { blocked: true, reason: riskRes.reason, detail: riskRes.detail };
        }
      } catch (_) {}
    }

    // 🔹 Optional liquidity gate (env-gated)
    if (cfg.liqGate && process.env.TURBO_SMART_EXIT_ENABLED === 'true') {
      const { minPoolUsd, maxImpactPctAtLarge, liqProbeSmallSol, liqProbeLargeSol } = cfg.liqGate;
      await assertMinLiquidity({
        userId: userCtx.userId,
        inputMintSOL: inputMint,
        outputMint,
        minPoolUsd,
        maxImpactPctAtLarge,
        smallSol: liqProbeSmallSol,
        largeSol: liqProbeLargeSol,
      });
    }

    const safeQuoteRes = await getSafeQuote({ inputMint, outputMint, amount, slippage });
    if (!safeQuoteRes.ok) {
      throw new Error(`quote-failed: ${safeQuoteRes.reason || 'unknown'}`);
    }
    const quote = safeQuoteRes.quote;

    // 🔹 Back-compat mapping for simple smart-exit flags → postBuyWatch
    if (process.env.TURBO_SMART_EXIT_ENABLED === 'true' && !cfg.postBuyWatch) {
      const { smartExitTimeMins, smartVolLookbackSec, smartVolThreshold, smartLiqLookbackSec, smartLiqDropPct } = cfg;
      const hasTime = smartExitTimeMins != null;
      const hasVol  = smartVolLookbackSec != null && smartVolThreshold != null;
      const hasLiq  = smartLiqLookbackSec != null && smartLiqDropPct != null;
      const mode = hasTime ? 'time' : hasVol ? 'volume' : hasLiq ? 'liquidity' : null;
      if (mode) {
        cfg.postBuyWatch = {
          durationSec: 180,
          smartExitMode: mode,
          smartExit: {
            time: { maxHoldSec: hasTime ? Number(smartExitTimeMins) * 60 : undefined },
            volume: {
              volWindowSec: hasVol ? Number(smartVolLookbackSec) : undefined,
              volDropPct  : hasVol ? Number(smartVolThreshold)   : undefined,
            },
            liquidity: { lpOutflowExitPct: hasLiq ? Number(smartLiqDropPct) : undefined },
          },
        };
      }
    }

    // Parallel wallets path
    if (cfg?.parallelWallets && cfg.parallelWallets.enabled) {
      const { wallets = [], splitPct = [], maxParallel = 2 } = cfg.parallelWallets;
      const idemSalt = cfg?.idempotency?.salt ?? process.env.IDEMPOTENCY_SALT ?? '';
      const slotBucketBase = cfg?.idempotency?.slotBucket ?? cfg?.slotBucket ?? '';
      const idKeyBase = crypto.createHash('sha256').update([userCtx.userId, userCtx.walletId, outputMint, quote?.inAmount ?? '', slotBucketBase, idemSalt].join('|')).digest('hex');
      const totalAmount = amount;
      const routes = [];
      const self = this;
      const results = await parallelFiller({
        totalAmount,
        routes,
        wallets,
        splitPct,
        maxParallel,
        idKeyBase,
        onExecute: async ({ wallet, amount: subAmt, idKey }) => {
          const start = Date.now();
          try {
            const subQuoteRes = await getSafeQuote({ inputMint, outputMint, amount: subAmt, slippage });
            if (!subQuoteRes.ok) {
              inc('parallel_wallet_fail_total', 1, { walletId: String(wallet) });
              observe('parallel_wallet_ms', Date.now() - start, { ok: false });
              return { ok: false, errorClass: 'QUOTE', error: new Error(`quote-failed: ${subQuoteRes.reason || 'unknown'}`) };
            }
            const subQuote = subQuoteRes.quote;
            const newMeta = Object.assign({}, cfg, {
              userId: userCtx.userId,
              walletId: wallet,
              slippage: slippage,
              validatorIdentity: self.validatorIdentity || cfg.validatorIdentity,
              idempotencyKey: idKey,
            });
            const sim = Boolean(cfg.dryRun);
            const txHash = await execTrade({ quote: subQuote, mint: outputMint, meta: newMeta, simulated: sim });
            inc('parallel_wallet_ok_total', 1, { walletId: String(wallet) });
            observe('parallel_wallet_ms', Date.now() - start, { ok: true });
            return { ok: !!txHash, txid: txHash };
          } catch (err) {
            inc('parallel_wallet_fail_total', 1, { walletId: String(wallet) });
            observe('parallel_wallet_ms', Date.now() - start, { ok: false });
            const cls = classifyError(err?.message || err?.toString());
            return { ok: false, errorClass: cls, error: err };
          }
        },
      });
      return results;
    }

    const metaObj = Object.assign({}, cfg, {
      userId: userCtx.userId,
      walletId: userCtx.walletId,
      slippage: slippage,
      validatorIdentity: this.validatorIdentity || cfg.validatorIdentity,
    });
    const simulatedRun = Boolean(cfg.dryRun);
    return execTrade({ quote, mint: outputMint, meta: metaObj, simulated: simulatedRun });
  }

  async buildAndSubmit() {
    throw new Error('buildAndSubmit is not implemented on the wrapper');
  }
}

module.exports = TradeExecutorTurbo;
module.exports.execTrade = execTrade;
module.exports.stopExecutorBackground = stopExecutorBackground;
module.exports.setKill = setKill;
