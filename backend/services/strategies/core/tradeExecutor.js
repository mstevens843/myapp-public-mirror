/* core/tradeExecutor.js
 * Arm-aware trade executor (enhanced):
 * - Uses in-memory DEK when armed; falls back to legacy decrypt when allowed.
 * - Adds free Turbo-derived safety/UX features with ZERO extra RPC or UI inputs:
 *     • Global kill switch (env KILL_SWITCH=1)
 *     • Pre-send duplicate guard (DB lookback 60s)
 *     • Deterministic idempotency TTL gate (+ in-memory result cache)
 *     • Per-mint cool-off window after failures
 *     • Tiny in-process caches for decimals and prices
 *     • Optional auto-create TP/SL rule when tp/sl present (DB only)
 */

const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { executeSwap }       = require("../../../utils/swap");
const { getMintDecimals }   = require("../../../utils/tokenAccounts");
const getTokenPriceModule   = require("../paid_api/getTokenPrice");
const getSolPrice           = getTokenPriceModule.getSolPrice;
const { sendAlert }         = require("../../../telegram/alerts");
const { trackPendingTrade } = require("./txTracker");

// 🔐 Arm session + envelope decrypt
const { getDEK } = require("../../../armEncryption/sessionKeyCache");
const { decryptPrivateKeyWithDEK } = require("../../../armEncryption/envelopeCrypto");

// 🔐 Legacy env-key encrypt/decrypt
const { decrypt } = require("../../../middleware/auth/encryption");

/* ======== ADD: zero-cost execution helpers (ported from Turbo) ======== */
const crypto = require("crypto");

// in-memory guards
const _coolOffByMint = Object.create(null);          // mint -> ts
const _idemCache     = new Map();                    // idKey -> { res:any, exp:number }
const _idTtlGate     = new Map();                    // idKey -> expiresAtMs

function idTtlCheckAndSet(idKey, ttlSec = 60) {
  if (!idKey || !ttlSec) return true;
  const now = Date.now();
  const exp = _idTtlGate.get(idKey);
  if (exp && exp > now) return false;
  _idTtlGate.set(idKey, now + ttlSec * 1000);
  return true;
}

let __KILLED = String(process.env.KILL_SWITCH || '').trim() === '1';
function requireAlive() { if (__KILLED) { const e = new Error("KILL_SWITCH_ACTIVE"); e.code="KILL"; throw e; } }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _idTtlGate.entries()) if (v <= now) _idTtlGate.delete(k);
  for (const [m, ts] of Object.entries(_coolOffByMint)) if (now - ts > 10 * 60_000) delete _coolOffByMint[m];
  for (const [k, v] of _idemCache.entries()) if (v?.exp && v.exp <= now) _idemCache.delete(k);
}, 60_000).unref?.();

function classifyError(msg = '') {
  const s = String(msg).toLowerCase();
  if (/slippage|insufficient (funds|liquidity)|slippage exceeded/.test(s)) return 'USER';
  if (/blockhash|node is behind|timed? out|connection|429|too many requests|rate limit|account in use/.test(s)) return 'NET';
  return 'UNKNOWN';
}

// tiny caches to avoid repeat lookups
const _decCache   = new Map(); // mint -> { v, exp }
const _priceCache = new Map(); // key -> { v, exp }

async function getDecimalsCached(mint) {
  const e = _decCache.get(mint); const now = Date.now();
  if (e && e.exp > now) return e.v;
  const v = await getMintDecimals(mint);
  _decCache.set(mint, { v, exp: now + 3600_000 });
  return v;
}

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function getPriceCached(userId, mint) {
  const key = `${userId||'anon'}:${mint}`; const e = _priceCache.get(key); const now = Date.now();
  if (e && e.exp > now) return e.v;
  const v = (await getTokenPriceModule(userId || null, mint)) || (mint === SOL_MINT ? await getSolPrice(userId) : null);
  _priceCache.set(key, { v, exp: now + 30_000 });
  return v;
}
/* ======== /ADD ======== */

const toNum = (v) => (v === undefined || v === null ? null : Number(v));

/**
 * 🔑 Arm-aware wallet loader
 * Priority:
 *  1) If wallet.encrypted (envelope v1) exists:
 *      - require an armed session (DEK present in memory) if wallet.isProtected = true
 *      - use decryptPrivateKeyWithDEK(blob, DEK, aad) (zero latency)
 *  2) Else (legacy path):
 *      - decrypt(row.privateKey) → base58 → Keypair
 */
async function loadWalletKeypairArmAware(userId, walletId) {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, encrypted: true, isProtected: true, privateKey: true }
  });
  if (!wallet) throw new Error("Wallet not found in DB.");

  const aad = `user:${userId}:wallet:${walletId}`;

  // Envelope path
  if (wallet.encrypted && wallet.encrypted.v === 1) {
    const dek = getDEK(userId, walletId); // in-memory from Arm session
    if (!dek) {
      // If wallet is protected OR user requires Arm -> block trading with 401
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { requireArmToTrade: true }
      });
      if (wallet.isProtected || user?.requireArmToTrade) {
        const err = new Error("Automation not armed");
        err.status = 401;
        err.code = "AUTOMATION_NOT_ARMED";
        throw err;
      }
      // Not protected & not required -> still cannot decrypt envelope without KEK.
      const err = new Error("Protected wallet requires an armed session");
      err.status = 401;
      err.code = "AUTOMATION_NOT_ARMED";
      throw err;
    }

    // Fast path: decrypt with DEK (no network/KMS)
    const pkBuf = decryptPrivateKeyWithDEK(wallet.encrypted, dek, aad);
    try {
      if (pkBuf.length !== 64) {
        throw new Error(`Unexpected secret key length: ${pkBuf.length}`);
      }
      return Keypair.fromSecretKey(new Uint8Array(pkBuf));
    } finally {
      pkBuf.fill(0); // zeroize
    }
  }

  // Legacy path (string ciphertext -> plaintext base58 -> bytes)
  if (wallet.privateKey) {
    const secretBase58 = decrypt(wallet.privateKey, { aad });
    try {
      const secretBytes = bs58.decode(secretBase58.trim());
      if (secretBytes.length !== 64) throw new Error("Invalid secret key length after legacy decryption");
      return Keypair.fromSecretKey(secretBytes);
    } finally {
      try { secretBase58.fill?.(0); } catch {}
    }
  }

  throw new Error("Wallet has no usable key material");
}

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
    // ======== ADD: optional idempotency inputs (no frontend changes required) ========
    idempotencyKey,
    idempotencyTtlMs = 60_000,
  } = meta;

  if (!userId || !walletId) throw new Error("userId and walletId are required in meta");

  console.log("🧩 META RECEIVED:", { walletId, userId });

  // ADD: global kill switch
  requireAlive();

  // ADD: pre-send duplicate guard (DB lookback 60s)
  const dupRecent = await prisma.trade.findFirst({
    where: {
      userId, walletId, mint, strategy, type: "buy",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  if (dupRecent?.txHash) {
    console.log("⛔ Pre-send duplicate guard hit -> returning existing tx:", dupRecent.txHash);
    return dupRecent.txHash; // zero-cost short-circuit
  }

  // ADD: deterministic idempotency (auto key if none supplied)
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

  // ADD: per-mint cool-off (7s default)
  const COOL_OFF_MS = 7_000;
  if (_coolOffByMint[mint] && Date.now() - _coolOffByMint[mint] < COOL_OFF_MS) {
    throw new Error(`coolOff active for mint ${mint}`);
  }

  // 🔑 LOAD KEYPAIR (Arm-aware)
  let wallet;
  try {
    wallet = await loadWalletKeypairArmAware(userId, walletId);
  } catch (err) {
    if (err.status === 401 || err.code === "AUTOMATION_NOT_ARMED") {
      err.expose = true;
      throw err;
    }
    throw err;
  }

  console.log(`🔑 Loaded wallet pubkey: ${wallet.publicKey.toBase58()}`);

  // ⬇️ Global MEV prefs (from userPreference)
  const userPrefs = await prisma.userPreference.findUnique({
    where: { userId_context: { userId, context: "default" } },
    select: { mevMode: true, briberyAmount: true, defaultPriorityFee: true },
  });

  const mevMode            = userPrefs?.mevMode || "fast";
  const briberyAmount      = userPrefs?.briberyAmount ?? 0;
  const shared             = mevMode === "secure";
  const priorityFeeLamports = toNum(metaPriority) ?? toNum(userPrefs?.defaultPriorityFee) ?? 0;

  console.log("🛡️ Using MEV prefs:", { mevMode, shared, briberyAmount, priorityFeeLamports });

  let txHash = null;
  // optional quorum wiring (env or meta)
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
  if (!simulated) {
    try {
      console.log("🔁 Executing live swap…");
      txHash = await executeSwap({
        quote,
        wallet,
        shared,
        priorityFee: priorityFeeLamports,
        briberyAmount,
        // quorum injection (keeps tight loop clean)
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
      trackPendingTrade(txHash, mint, strategy);
    } catch (err) {
      _coolOffByMint[mint] = Date.now(); // ADD: start cooldown on any failure
      console.error("❌ Swap failed:", err.message);
      throw new Error(`swap-failed: ${err.message || err}`);
    }
  } else {
    // OPTIONAL: if you want dry-runs to be truly free, uncomment the next line:
    // return { simulated: true };
  }

  /* Enrichment — switch to cached helpers to reduce lookups */
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
    usdValue      = baseUsd ? +((quote.inAmount / 1e9) * baseUsd).toFixed(2) : null;
    console.log("📊 Enrichment done:", { entryPrice, entryPriceUSD, usdValue });
  } catch (err) {
    console.error("❌ Enrichment error:", err.message);
  }

  if (!walletId) throw new Error("❌ walletId missing from meta");
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
      unit:
        quote.inputMint === SOL_MINT ? "sol" :
        quote.inputMint === USDC_MINT ? "usdc" : "spl",
      slippage,
      decimals,
      usdValue,
      type: "buy",
      side: "buy",
      botId: meta.botId || strategy,
      walletId,
      walletLabel,
      mevMode,
      priorityFee: priorityFeeLamports,
      briberyAmount,
      mevShared: shared,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
    })
  );

  // Deduplicate recent trade (kept from original implementation)
  const recent = await prisma.trade.findFirst({
    where: {
      userId,
      mint,
      strategy,
      type: "buy",
      createdAt: { gte: new Date(Date.now() - 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    console.log(`⚠️ Duplicate trade detected within lookback window for mint ${mint}, skipping create`);
    // Note: we already do a pre-send guard; this is a no-op safety.
    return txHash;
  }

  await prisma.trade.create({
    data: {
      id: uuid(),
      mint,
      entryPrice,
      entryPriceUSD,
      inAmount: BigInt(quote.inAmount),
      outAmount: BigInt(quote.outAmount),
      strategy,
      txHash,
      userId,
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
      briberyAmount,
      mevShared: shared,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
    },
  });

  // ======== ADD: auto-create TP/SL rule if already supplied (no new inputs) ========
  if (((Number(tp) || 0) !== 0 || (Number(sl) || 0) !== 0) && !["rotationbot", "rebalancer"].includes(String(strategy||"").toLowerCase())) {
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

  /* Alerts */
  const amountFmt = (quote.outAmount / 10 ** (decimals || 0)).toFixed(4);
  const impactFmt = (quote.priceImpactPct * 100).toFixed(2) + "%";
  const header = simulated ? `🧪 *Dry-Run ${category} Triggered!*` : `🤖 *${category} Buy Executed!*`;
  const msg =
    `${header}\n` +
    `• *Token:* [${mint}](https://birdeye.so/token/${mint})\n` +
    `• *Amount:* ${amountFmt}\n` +
    `• *Impact:* ${impactFmt}\n` +
    (simulated ? "• *Simulated:* ✅" : `• *Tx:* [↗️ View](https://solscan.io/tx/${txHash})`);
  await sendAlert("ui", msg, category);

  return txHash;
}

const liveBuy     = (o) => execTrade({ ...o, simulated: false });
const simulateBuy = (o) => execTrade({ ...o, simulated: true  });

/*
 * ──────────────────────────────────────────────────────────────────────────
 * Extended execution shapes
 *
 * Some strategies require more sophisticated execution than a single market
 * swap.  For example, the Trend Follower might wish to accumulate over
 * several blocks using a TWAP/VWAP ladder, while the Scalper may need
 * atomic enter→cancel/replace→exit loops to control slippage and timing.
 *
 * The default implementations below simply delegate to liveBuy so that
 * existing strategies (like Sniper) continue to behave exactly as before.
 * When you implement TWAP or atomic scalping, replace the bodies of
 * these functions with your custom logic.  Both functions accept the
 * same options object as liveBuy/simulateBuy.
 */

async function executeTWAP(opts) {
  // Perform a simple time‑weighted execution by breaking the quote
  // into several smaller chunks.  We reference a preferred ladder
  // from the risk policy when available or default to a 20/30/50
  // split.  After each slice we invoke the configured risk hooks
  // (if present) and introduce a short non‑blocking delay.  No
  // additional network or database calls are made in this loop.
  const { quote, mint, meta } = opts || {};
  const slices = (meta && meta.riskPolicy && Array.isArray(meta.riskPolicy.twapSlices))
    ? meta.riskPolicy.twapSlices
    : [0.2, 0.3, 0.5];
  let lastTx = null;
  for (const ratio of slices) {
    let partialQuote = quote;
    try {
      if (quote && quote.inAmount != null && quote.outAmount != null) {
        const inAmt  = BigInt(quote.inAmount);
        const outAmt = BigInt(quote.outAmount);
        const partIn  = BigInt(Math.floor(Number(inAmt)  * ratio));
        const partOut = BigInt(Math.floor(Number(outAmt) * ratio));
        partialQuote = { ...quote, inAmount: partIn, outAmount: partOut };
      }
    } catch (_) {
      partialQuote = quote;
    }
    try {
      const risk = meta && meta.riskPolicy;
      if (risk) {
        if (typeof risk.nextStop === 'function') risk.nextStop(meta.position || {});
        if (typeof risk.shouldExit === 'function') risk.shouldExit(meta.position || {}, {});
      }
    } catch {}
    lastTx = await liveBuy({ ...opts, quote: partialQuote });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return lastTx;
}

async function executeAtomicScalp(opts) {
  // Execute an atomic scalp.  In its simplest form this is just a
  // single call to liveBuy.  After execution we invoke the risk
  // hooks once to allow for immediate exit decisions.  No additional
  // network I/O or cancellations are performed here.
  const { meta } = opts || {};
  const tx = await liveBuy(opts);
  try {
    const risk = meta && meta.riskPolicy;
    if (risk) {
      if (typeof risk.nextStop === 'function') risk.nextStop(meta.position || {});
      if (typeof risk.shouldExit === 'function') risk.shouldExit(meta.position || {}, {});
    }
  } catch {}
  return tx;
}

module.exports = { liveBuy, simulateBuy, executeTWAP, executeAtomicScalp };