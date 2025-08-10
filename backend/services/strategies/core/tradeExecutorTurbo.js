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
const { Keypair, Connection, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");

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
const NET_ERRS = [/blockhash/i, /node is behind/i, /timed? out/i,
/connection/i, /getblockheight timed out/i];
const USER_ERRS = [/slippage/i, /insufficient funds/i, /mint.*not found/i,
/account in use/i, /slippage exceeded/i];
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

//  Existing infra
const LeaderScheduler = require("./leaderScheduler");
const QuoteWarmCache  = require("./quoteWarmCache");

// Additional helpers for Turbo enhancements
const JitoFeeController = require("./jitoFeeController");
const { directSwap } = require("../../../utils/raydiumDirect");
const metricsLogger = require("../logging/metrics"); // keep preexisting metrics

// Import new parallel filler (Prompt 5)
const { parallelFiller } = require('./parallelFiller');

// ── Risk gating
const { passes } = require('./passes');
const idempotencyStore = require("../../../utils/idempotencyStore"); // existing in your repo (short-TTL cache)

//  NEW core modules added by Prompt 1 (shadow mempool + deterministic idempotency + sizing + probe)
const RelayClient = require('./relays/relayClient');                 // new abstraction (feature-flag)
const CoreIdemStore = require('./idempotencyStore');                 // crash-safe resume window (disk-backed)
const { sizeTrade } = require('./liquiditySizer');                   // liquidity-aware sizing
const { performProbe } = require('./probeBuyer');                    // micro-buy then scale

//   Arm / envelope-crypto helpers
const { getDEK } = require("../../../armEncryption/sessionKeyCache");
const {
  decryptPrivateKeyWithDEK,
} = require("../../../armEncryption/envelopeCrypto");
const { decrypt } = require("../../../middleware/auth/encryption");

//   Ghost utilities
const {
  forwardTokens,
  checkFreezeAuthority,
} = require("./ghost");

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
 *  Priority fee helper
 * ──────────────────────────────────────────── */
/**
 * Combine autoPriorityFee and explicit min/max/override settings to derive
 * a compute unit price in microLamports. Also returns any configured Jito
 * tip (lamports).
 */
function getPriorityFee(cfg = {}, attempt = 0) {
  const auto = !!cfg.autoPriorityFee;
  const min = Number(cfg.cuPriceMicroLamportsMin ?? 0) || 0;
  const max = Number(cfg.cuPriceMicroLamportsMax ?? min) || min;
  let cuMicro = 0;
  if (auto) {
    if (max > min) {
      const steps = 3;
      const step = Math.ceil((max - min) / steps);
      cuMicro = Math.min(max, min + attempt * step);
    } else {
      cuMicro = min;
    }
  } else {
    cuMicro = Number(cfg.priorityFeeLamports || 0) || 0; // treat as microLamports
  }
  const tipLamports = Math.max(0, Number(cfg.jitoTipLamports || 0) || 0);
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
  } = meta;

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
  if (rpcFailover && endpoints.length >= 1) {
    rpcPool = new RpcPool(endpoints);
  }

  // helper: refresh recent blockhash on primary (pre-send)
  async function _preSendRefresh() {
    try {
      await conn.getLatestBlockhash('confirmed');
      metricsLogger.recordBlockhashRefresh?.(conn._rpcEndpoint || 'primary');
    } catch (_) { /* ignore */ }
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

  try {
    const _quoteDuration = Date.now() - _quoteStart;
    observe('hotpath_ms', _quoteDuration, { stage: 'quote', strategy: 'turbo' });
  } catch (_) {}

  if (!sizedQuote) throw new Error('sizing/quote unavailable');

  // --- Dry-run short-circuit (no network) ---
  const isDryRun = simulated || Boolean(dryRun);
  if (isDryRun) {
    const usedDirect = !!(directAmmFallback && shouldDirectAmmFallback({
      quoteAgeMs: quoteLatencyMs,
      fallbackQuoteLatencyMs,
      poolFresh,
      volatilityPct,
      maxVolatilityPct,
    }));

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
    ? async (rawTx, sendOpts) => rpcPool.sendRawTransactionQuorum(rawTx, sendOpts || {})
    : null;

  // Sender
  async function sendOnce(localQuote) {
    let txHash = null;
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(retryPolicy?.max ?? 3));
    let jitoMode = !!useJitoBundle;
    let usedDirect = false;

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
        }, attempt);

        // Direct AMM fallback when quote is stale & pool fresh/low-vol
        if (!usedDirect && directAmmFallback && attempt === 0) {
          const doFallback = shouldDirectAmmFallback({
            quoteAgeMs: quoteLatencyMs,
            fallbackQuoteLatencyMs,
            poolFresh,
            volatilityPct,
            maxVolatilityPct,
          });
          if (doFallback) {
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

        // UNKNOWN: conservative single CU bump
        if (cls === 'UNKNOWN') {
          // rely on getPriorityFee bump via attempt index
          metricsLogger.recordRetry?.();
        }

        // NET: bump path per attempt
        if (cls === 'NET') {
          if (attempt === 3 && retryPolicy.routeSwitch) {
            jitoMode = !jitoMode;
          } else if (attempt >= 4 && retryPolicy.rpcFailover && endpoints.length > 1) {
            const idx = (endpoints.indexOf(currentRpcUrl) + 1) % endpoints.length;
            currentRpcUrl = endpoints[idx] || currentRpcUrl;
            conn = new Connection(currentRpcUrl, 'confirmed');
            try { ensurePrewarm(conn); } catch (_) {}
          }
          metricsLogger.recordRetry?.();
        }

        // Refresh quote after changes
        try {
          await _preSendRefresh();
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
        if (!active || Date.now() > endTime) {
          clearInterval(intervalId);
          return;
        }
        try {
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

    const safeQuoteRes = await getSafeQuote({ inputMint, outputMint, amount, slippage });
    if (!safeQuoteRes.ok) {
      throw new Error(`quote-failed: ${safeQuoteRes.reason || 'unknown'}`);
    }
    const quote = safeQuoteRes.quote;

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
