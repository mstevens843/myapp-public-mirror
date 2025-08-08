// backend/services/strategies/core/tradeExecutorTurbo.js
/**
 * turboTradeExecutor.js – Turbo-path trade executor
 * -------------------------------------------------
 * • Arm-to-Trade envelope decryption (in-memory DEK)
 * • Ultra-fast swap via executeSwapTurbo() / executeSwapJitoBundle()
 * • Leader-timed send, warm quote cache, retry matrix, idempotency TTL
 * • Post-trade side-effects (non-blocking):
 *     – TP/SL rule insert
 *     – Telegram alert
 *     – Ghost-mode forwarding
 *     – Auto-rug check & exit
 */

'use strict';

const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair, Connection, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");
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

// 🔧 New infra from “you gave me”
const LeaderScheduler = require("./leaderScheduler");
const QuoteWarmCache  = require("./quoteWarmCache");

// Additional helpers for Turbo enhancements
const JitoFeeController = require("./jitoFeeController");
const { directSwap } = require("../../../utils/raydiumDirect");
const metricsLogger = require("../logging/metrics");
const idempotencyStore = require("../../../utils/idempotencyStore");

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

const SOL_MINT =
  "So11111111111111111111111111111111111111112";
const USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const toNum = (v) =>
  v === undefined || v === null ? null : Number(v);

/* ──────────────────────────────────────────────
 *  Warm Quote Cache (shared per TTL bucket)
 * ──────────────────────────────────────────── */
const _quoteCaches = new Map(); // ttlMs -> QuoteWarmCache
function getQuoteCache(ttlMs = 600) {
  const key = Number(ttlMs) || 0;
  if (!_quoteCaches.has(key)) {
    _quoteCaches.set(key, new QuoteWarmCache({ ttlMs: key, capacity: 200 }));
  }
  return _quoteCaches.get(key);
}

/* ──────────────────────────────────────────────
 *  Idempotency TTL Gate (in addition to idempotencyStore)
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
    idempotencyTtlSec = 60,

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
  } = meta;

  if (!userId || !walletId)
    throw new Error("userId and walletId are required in meta");

  const wallet = await loadWalletKeypairArmAware(userId, walletId);

  // pick RPC for this attempt; may be rotated by retry loop
  let currentRpcUrl = privateRpcUrl || process.env.PRIVATE_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL;
  let conn = new Connection(currentRpcUrl, 'confirmed');

  // ---- LEADER TIMING HOLD (pre-send) ----
  if (leaderTiming?.enabled && bundleStrategy !== 'private' && validatorIdentity) {
    try {
      const sched = getLeaderScheduler(conn, validatorIdentity);
      const { holdMs } = await sched.shouldHoldAndFire(Date.now(), leaderTiming);
      if (holdMs > 0) {
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, holdMs));
        metricsLogger.recordTiming('leader_hold_ms', Date.now() - t0);
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

  // Idempotency: immediate replay protection (TTL gate)
  const idKey = meta.idempotencyKey;
  if (idKey) {
    const pass = idTtlCheckAndSet(idKey, idempotencyTtlSec);
    if (!pass) {
      const cached = idempotencyStore.get(idKey);
      if (cached) return cached;
      // duplicate within TTL and no cached tx → block
      metricsLogger.recordFail('dupe-blocked');
      throw new Error('duplicate attempt blocked');
    }
    const cached = idempotencyStore.get(idKey);
    if (cached) return cached;
  }

  // Dynamic slippage limit
  let effSlippage = slippage;
  if (dynamicSlippageMaxPct) {
    const ds = Number(dynamicSlippageMaxPct);
    if (Number.isFinite(ds) && ds > 0) {
      effSlippage = Math.min(slippage, ds / 100);
    }
  }
  // Impact guard: abort early if quoted price impact is too high
  if (impactAbortPct > 0 && quote?.priceImpactPct != null) {
    const pct = quote.priceImpactPct * 100;
    if (pct > impactAbortPct) {
      metricsLogger.recordFail('impact-abort');
      throw new Error('abort: price impact too high');
    }
  }

  // Helper: warm quote cache wrapper
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
    metricsLogger.recordTiming('quote_latency_ms', Date.now() - t0);
    if (fresh) quoteCache.set(key, fresh);
    return fresh;
  }

  /*
   * Iceberg splitting – unchanged core behavior, but switch to warm quotes
   */
  if (!simulated && iceberg && iceberg.enabled && Number(iceberg.tranches) > 1) {
    try {
      const tranches = Math.max(1, parseInt(iceberg.tranches, 10));
      const delayMs = Number(iceberg.trancheDelayMs) || 0;
      const totalIn = Number(quote.inAmount);
      const per = Math.floor(totalIn / tranches);
      let remaining = totalIn;
      let lastTx = null;
      for (let i = 0; i < tranches; i++) {
        const thisAmount = i === tranches - 1 ? remaining : per;
        remaining -= thisAmount;
        const qRes = await getWarmQuote({
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: String(thisAmount),
          slippage: effSlippage,
        });
        if (!qRes) {
          metricsLogger.recordFail('iceberg-quote');
          break;
        }
        if (impactAbortPct > 0 && qRes.priceImpactPct != null && qRes.priceImpactPct * 100 > impactAbortPct) {
          metricsLogger.recordFail('iceberg-impact-abort');
          break;
        }
        const nestedMeta = {
          ...meta,
          iceberg: { ...iceberg, enabled: false },
          idempotencyKey: idKey ? `${idKey}:${i}` : undefined,
        };
        try {
          lastTx = await execTrade({ quote: qRes, mint, meta: nestedMeta, simulated });
        } catch (_) { break; }
        if (delayMs > 0 && i < tranches - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return lastTx;
    } catch (ie) {
      console.warn('Iceberg execution error:', ie.message);
    }
  }

  /*
   * RETRY MATRIX AROUND SEND:
   * - attempt 0: chosen path (Jito if enabled else Turbo; Direct only on fallback condition)
   * - on each retry:
   *    * bump CU/priority fee (lamports) and bribery tip
   *    * optional route switch (toggle jito<->turbo OR try direct)
   *    * RPC failover (rotate RPC endpoint)
   *    * optionally refresh quote (warm cache)
   */
  let txHash = null;
  let attempt = 0;
  const maxAttempts = Math.max(1, Number(retryPolicy?.max ?? 3));
  let briberyAmount = Number(briberyAmountBase) || 0;
  let priorityFee = Number(basePriorityFeeLamports) || 0;
  let jitoMode = !!useJitoBundle;
  let usedDirect = false;

  while (attempt < maxAttempts && !txHash) {
    try {
      // Direct fallback if requested by meta and quoteLatency hints (priority on first attempt)
      if (!usedDirect && directAmmFallback && typeof meta.quoteLatencyMs === 'number' && meta.quoteLatencyMs > 200 && attempt === 0) {
        const startSlot = await conn.getSlot();
        txHash = await directSwap({
          wallet,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: String(quote.inAmount),
          slippage: effSlippage,
          privateRpcUrl: currentRpcUrl,
        });
        const endSlot = await conn.getSlot();
        if (txHash) {
          metricsLogger.recordInclusion(endSlot - startSlot);
          metricsLogger.recordSuccess();
          usedDirect = true;
          break;
        } else {
          metricsLogger.recordFail('direct-swap-fail');
        }
      }

      // Choose path (Jito or Turbo)
      if (jitoMode) {
        const controller = new JitoFeeController({
          cuAdapt,
          cuPriceMicroLamportsMin,
          cuPriceMicroLamportsMax,
          tipCurve,
          baseTipLamports: jitoTipLamports || 1000,
        });
        // Controller can be static or bumped via attempt count
        const fees = controller.getFee(attempt);
        const startSlot = await conn.getSlot();
        txHash = await executeSwapJitoBundle({
          quote,
          wallet,
          shared,
          priorityFee: fees.computeUnitPriceMicroLamports, // Jito expects CU price μLamports
          briberyAmount: 0,
          jitoRelayUrl,
        });
        const endSlot = await conn.getSlot();
        if (txHash) {
          metricsLogger.recordInclusion(endSlot - startSlot);
          metricsLogger.recordSuccess();
        }
      } else {
        const startSlot = await conn.getSlot();
        txHash = await executeSwapTurbo({
          quote,
          wallet,
          shared,
          priorityFee,       // lamports
          briberyAmount,     // lamports
          privateRpcUrl: currentRpcUrl,
          skipPreflight,
        });
        const endSlot = await conn.getSlot();
        if (txHash) {
          metricsLogger.recordInclusion(endSlot - startSlot);
          metricsLogger.recordSuccess();
        }
      }

      if (!txHash) throw new Error('swap-failed');
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        metricsLogger.recordFail(err?.code || err?.message || 'swap-error');
        throw err;
      }
      // Bump CU / tip (we only have lamport priority/ tip here)
      priorityFee += Number(retryPolicy.bumpCuStep || 2000);
      briberyAmount += Number(retryPolicy.bumpTipStep || 1000);
      metricsLogger.recordRetry();

      // Route switch on 2nd try
      if (retryPolicy.routeSwitch && attempt === 2) {
        // toggle Jito <-> Turbo; if already Turbo, consider direct on next round
        jitoMode = !jitoMode;
      }

      // RPC failover on last retry step before final
      if (retryPolicy.rpcFailover && attempt === (maxAttempts - 1)) {
        const endpoints = Array.isArray(meta.rpcEndpoints) ? meta.rpcEndpoints : [];
        if (endpoints.length > 1) {
          const idx = (endpoints.indexOf(currentRpcUrl) + 1) % endpoints.length;
          currentRpcUrl = endpoints[idx];
          conn = new Connection(currentRpcUrl, 'confirmed');
        }
      }

      // Refresh quote if warm cache expired or after route change
      try {
        const qRes = await getWarmQuote({
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: String(quote.inAmount),
          slippage: effSlippage,
        });
        if (qRes) quote = qRes;
      } catch (_) { /* keep last */ }
    }
  }

  // Cache idempotency key on success
  if (!simulated && idKey && txHash) {
    idempotencyStore.set(idKey, txHash);
  }

  /* ——— 2️⃣  Enrichment ——— */
  let entryPriceUSD = null,
    usdValue = null,
    entryPrice = null,
    decimals = null;
  try {
    const inDec = await getMintDecimals(quote.inputMint);
    const outDec = await getMintDecimals(quote.outputMint);
    const inUi = Number(quote.inAmount) / 10 ** inDec;
    const outUi = Number(quote.outAmount) / 10 ** outDec;
    decimals = outDec;
    entryPrice = inUi / outUi;
    const baseUsd =
      (await getTokenPrice(userId, quote.inputMint)) ||
      (quote.inputMint === SOL_MINT
        ? await getSolPrice(userId)
        : null);
    entryPriceUSD = baseUsd ? entryPrice * baseUsd : null;
    usdValue = baseUsd
      ? +((quote.inAmount / 1e9) * baseUsd).toFixed(2)
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
        inAmount: BigInt(quote.inAmount),
        outAmount: BigInt(quote.outAmount),
        closedOutAmount: BigInt(0),
        strategy,
        txHash,
        userId,
        walletId,
        walletLabel,
        botId: botId || strategy,
        unit:
          quote.inputMint === SOL_MINT
            ? "sol"
            : quote.inputMint === USDC_MINT
            ? "usdc"
            : "spl",
        decimals,
        usdValue,
        type: "buy",
        side: "buy",
        slippage,
        mevMode,
        priorityFee: priorityFee,
        briberyAmount,
        mevShared: shared,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
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
      const amountFmt = txHash ? (quote.outAmount / 10 ** (decimals || 9)).toFixed(4) : "0";
      const impactFmt =
        (quote.priceImpactPct * 100).toFixed(2) + "%";
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
          const amt = BigInt(quote.outAmount);
          await forwardTokens(
            connPost,
            quote.outputMint,
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
          quote.outputMint
        );
        if (freezeAuth) {
          console.warn(
            `🚨 Honeypot detected (freezeAuthority: ${freezeAuth})`
          );
          const sellQuote = await getWarmQuote({
            inputMint: quote.outputMint,
            outputMint: quote.inputMint,
            amount: String(quote.outAmount),
            slippage: slippage || 5.0,
          });
          if (sellQuote) {
            await executeSwapTurbo({
              quote: sellQuote,
              wallet,
              shared,
              priorityFee,
              briberyAmount,
              privateRpcUrl: currentRpcUrl,
              skipPreflight,
            });
          }
        }
      } catch (e) {
        console.warn("Auto-rug failed:", e.message);
      }
    }

    /* Post-buy watcher */
    if (txHash && postBuyWatch) {
      const { durationSec = 180, lpPullExit = true, authorityFlipExit = true } = postBuyWatch;
      const startTime = Date.now();
      const endTime = startTime + Math.max(0, durationSec) * 1000;
      const intervalMs = 5000;
      const sellInputMint = quote.outputMint;
      const sellOutputMint = quote.inputMint;
      const sellAmount = quote.outAmount;
      let active = true;
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
              if (sq) {
                try {
                  await executeSwapTurbo({
                    quote: sq,
                    wallet,
                    shared,
                    priorityFee,
                    briberyAmount,
                    privateRpcUrl: currentRpcUrl,
                    skipPreflight,
                  });
                } catch { /* ignore */ }
              }
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Authority flip
          if (authorityFlipExit) {
            const freeze = await checkFreezeAuthority(connPost, sellInputMint);
            if (freeze) {
              const exitQuote = await getWarmQuote({
                inputMint: sellInputMint,
                outputMint: sellOutputMint,
                amount: String(sellAmount),
                slippage: 5.0,
              });
              if (exitQuote) {
                try {
                  await executeSwapTurbo({
                    quote: exitQuote,
                    wallet,
                    shared,
                    priorityFee,
                    briberyAmount,
                    privateRpcUrl: currentRpcUrl,
                    skipPreflight,
                  });
                } catch { /* ignore */ }
              }
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

module.exports = execTrade;
