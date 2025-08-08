// backend/services/strategies/core/tradeExecutorTurbo.js
/**
 * turboTradeExecutor.js – Turbo-path trade executor
 * -------------------------------------------------
 * • Arm-to-Trade envelope decryption (in-memory DEK)
 * • Ultra-fast swap via executeSwapTurbo()
 * • Post-trade side-effects (non-blocking):
 *     – TP/SL rule insert
 *     – Telegram alert
 *     – Ghost-mode forwarding
 *     – Auto-rug check & exit
 */

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
  } = meta;

  if (!userId || !walletId)
    throw new Error("userId and walletId are required in meta");

  const wallet = await loadWalletKeypairArmAware(userId, walletId);

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
  const briberyAmount = prefs?.briberyAmount ?? 0;
  const shared = mevMode === "secure";
  const priorityFeeLamports =
    toNum(meta.priorityFeeLamports) ??
    toNum(prefs?.defaultPriorityFee) ??
    0;

  /*
   * 1️⃣ Swap execution with enhancements
   *
   * Instead of always calling executeSwapTurbo directly, we first handle
   * idempotency, impact guards, dynamic slippage and optional Jito
   * bundle execution.  If the caller has set a unique idempotencyKey
   * then repeated invocations will return the same tx hash from the
   * in‑memory idempotency store.  Impact guards abort the trade when
   * the quoted price impact exceeds a configured threshold.  Dynamic
   * slippage limits slippage to a maximum value.  When Jito bundling
   * is enabled the swap is submitted via Jito’s relay with adaptive
   * compute unit pricing and tip; otherwise the turbo path is used.  A
   * fallback direct Raydium swap is attempted when aggregator quote
   * latency is high.
   */
  let txHash = null;
  // Idempotency: return prior result if exists
  const idKey = meta.idempotencyKey;
  if (idKey) {
    const cached = idempotencyStore.get(idKey);
    if (cached) {
      return cached;
    }
  }

  // Dynamic slippage limit
  let effSlippage = slippage;
  if (meta.dynamicSlippageMaxPct) {
    const ds = Number(meta.dynamicSlippageMaxPct);
    if (Number.isFinite(ds) && ds > 0) {
      effSlippage = Math.min(slippage, ds / 100);
    }
  }
  // Impact guard: abort early if quoted price impact is too high
  const impactAbortPct = Number(meta.impactAbortPct) || 0;
  if (impactAbortPct > 0 && quote.priceImpactPct != null) {
    const pct = quote.priceImpactPct * 100;
    if (pct > impactAbortPct) {
      metricsLogger.recordFail('impact-abort');
      throw new Error('abort: price impact too high');
    }
  }

  /*
   * Iceberg splitting
   *
   * When configured to use iceberg entries we subdivide the total input
   * amount into N tranches and execute them sequentially.  Between
   * tranches an optional delay may be applied.  Before each tranche
   * executes we request a fresh quote; if the resulting price impact
   * exceeds the configured `impactAbortPct` the remainder of the
   * iceberg is aborted.  Each tranche uses its own idempotency key
   * suffix to prevent cache collisions.  Recursion is used to reuse
   * the existing execution logic; the `iceberg.enabled` flag is
   * temporarily disabled on the nested call to avoid infinite
   * splitting.
   */
  if (!simulated && meta.iceberg && meta.iceberg.enabled && Number(meta.iceberg.tranches) > 1) {
    try {
      const tranches = Math.max(1, parseInt(meta.iceberg.tranches, 10));
      const delayMs = Number(meta.iceberg.trancheDelayMs) || 0;
      const totalIn = Number(quote.inAmount);
      const per = Math.floor(totalIn / tranches);
      let remaining = totalIn;
      let lastTx = null;
      for (let i = 0; i < tranches; i++) {
        const thisAmount = i === tranches - 1 ? remaining : per;
        remaining -= thisAmount;
        // Fresh quote per tranche
        const qRes = await getSwapQuote({
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: String(thisAmount),
          slippage: effSlippage,
          multiRoute: meta.multiRoute,
          splitTrade: meta.splitTrade,
          allowedDexes: meta.allowedDexes,
          excludedDexes: meta.excludedDexes,
        });
        if (!qRes) {
          metricsLogger.recordFail('iceberg-quote');
          break;
        }
        // Abort on high impact
        if (impactAbortPct > 0 && qRes.priceImpactPct != null && qRes.priceImpactPct * 100 > impactAbortPct) {
          metricsLogger.recordFail('iceberg-impact-abort');
          break;
        }
        // Disable further splitting for nested execution and set a unique idempotency key suffix
        const nestedMeta = {
          ...meta,
          iceberg: { ...meta.iceberg, enabled: false },
          idempotencyKey: meta.idempotencyKey ? `${meta.idempotencyKey}:${i}` : undefined,
        };
        try {
          lastTx = await execTrade({ quote: qRes, mint, meta: nestedMeta, simulated });
        } catch (e) {
          // If a tranche fails, abort the remainder
          break;
        }
        // Wait between tranches if configured
        if (delayMs > 0 && i < tranches - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return lastTx;
    } catch (ie) {
      // If iceberg fails unexpectedly fall through to normal execution
      console.warn('Iceberg execution error:', ie.message);
    }
  }

  // Swap execution (only when not simulated)
  if (!simulated) {
    // Optionally fallback to a direct Raydium swap when quote latency is high
    let usedDirect = false;
    if (meta.directAmmFallback && typeof meta.quoteLatencyMs === 'number' && meta.quoteLatencyMs > 200) {
      try {
        const startSlot = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
        txHash = await directSwap({
          wallet,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: String(quote.inAmount),
          slippage: effSlippage,
          privateRpcUrl,
        });
        if (txHash) {
          const endSlot = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
          metricsLogger.recordInclusion(endSlot - startSlot);
          metricsLogger.recordSuccess();
          usedDirect = true;
        } else {
          metricsLogger.recordFail('direct-swap-fail');
        }
      } catch (e) {
        metricsLogger.recordFail(e.code || e.message || 'direct-swap-error');
      }
    }
    // Standard or Jito swap when not using direct fallback
    if (!usedDirect) {
      try {
        if (meta.useJitoBundle) {
          // Adaptive Jito bundle: try several attempts with ramping CU price and tip
          const controller = new JitoFeeController({
            cuAdapt: meta.cuAdapt,
            cuPriceMicroLamportsMin: meta.cuPriceMicroLamportsMin,
            cuPriceMicroLamportsMax: meta.cuPriceMicroLamportsMax,
            tipCurve: meta.tipCurve || 'flat',
            baseTipLamports: meta.jitoTipLamports || 1000,
          });
          let success = false;
          let attempt = 0;
          while (!success && attempt < 5) {
            attempt++;
            const fees = controller.getFee();
            try {
              const startSlot = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
              txHash = await executeSwapJitoBundle({
                quote,
                wallet,
                shared,
                priorityFee: fees.computeUnitPriceMicroLamports,
                briberyAmount: 0,
                jitoRelayUrl: meta.jitoRelayUrl,
                jitoTipLamports: fees.tipLamports,
              });
              if (txHash) {
                const endSlot = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
                metricsLogger.recordInclusion(endSlot - startSlot);
                metricsLogger.recordSuccess();
                success = true;
                break;
              }
            } catch (e) {
              metricsLogger.recordRetry();
            }
          }
          if (!txHash) {
            // Fallback to turbo path if Jito fails
            const startSlotFallback = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
            txHash = await executeSwapTurbo({
              quote,
              wallet,
              shared,
              priorityFee: priorityFeeLamports,
              briberyAmount,
              privateRpcUrl,
              skipPreflight,
            });
            const endSlotFallback = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
            metricsLogger.recordInclusion(endSlotFallback - startSlotFallback);
          }
        } else {
          // Standard turbo path
          const startSlotTurbo = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
          txHash = await executeSwapTurbo({
            quote,
            wallet,
            shared,
            priorityFee: priorityFeeLamports,
            briberyAmount,
            privateRpcUrl,
            skipPreflight,
          });
          const endSlotTurbo = await new Connection(privateRpcUrl || process.env.SOLANA_RPC_URL, 'confirmed').getSlot();
          metricsLogger.recordInclusion(endSlotTurbo - startSlotTurbo);
        }
        if (!txHash) {
          throw new Error('swap-failed');
        }
        // Track pending for aggregator/turbo paths
        trackPendingTrade(txHash, mint, strategy);
      } catch (e) {
        metricsLogger.recordFail(e.code || e.message || 'swap-error');
        throw e;
      }
    }
    // Cache idempotency key on success
    if (idKey && txHash) {
      idempotencyStore.set(idKey, txHash);
    }
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
  if (!dup) {
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
        priorityFee: priorityFeeLamports,
        briberyAmount,
        mevShared: shared,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
      },
    });
  }

  /* ——— 4️⃣  Post-trade side-effects (non-blocking) ——— */
  (async () => {
    const conn = new Connection(
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
      const amountFmt = (
        quote.outAmount /
        10 ** decimals
      ).toFixed(4);
      const impactFmt =
        (quote.priceImpactPct * 100).toFixed(2) + "%";
      const header = simulated
        ? `🧪 *Dry-Run ${category} Triggered!*`
        : `🤖 *${category} Buy Executed!*`;
      const msg =
        `${header}\n` +
        `• *Token:* [${mint}](https://birdeye.so/token/${mint})\n` +
        `• *Amount:* ${amountFmt}\n` +
        `• *Impact:* ${impactFmt}\n` +
        (simulated
          ? "• *Simulated:* ✅"
          : `• *Tx:* [↗️ View](https://solscan.io/tx/${txHash})`);
      await sendAlert("ui", msg, category);
    } catch (e) {
      console.warn("Alert failed:", e.message);
    }

    /* Ghost mode */
    if (ghostMode && coverWalletId) {
      try {
        const coverRow = await prisma.wallet.findUnique({
          where: { id: coverWalletId },
          select: { publicKey: true },
        });
        if (coverRow?.publicKey) {
          const dest = new PublicKey(coverRow.publicKey);
          const amt = BigInt(quote.outAmount);
          await forwardTokens(
            conn,
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
    if (autoRug) {
      try {
        const freezeAuth = await checkFreezeAuthority(
          conn,
          quote.outputMint
        );
        if (freezeAuth) {
          console.warn(
            `🚨 Honeypot detected (freezeAuthority: ${freezeAuth})`
          );
          const sellQuote = await getSwapQuote({
            inputMint: quote.outputMint,
            outputMint: quote.inputMint,
            amount: quote.outAmount,
            slippage: slippage || 5.0,
          });
          if (sellQuote) {
            await executeSwapTurbo({
              quote: sellQuote,
              wallet,
              shared,
              priorityFee: priorityFeeLamports,
              briberyAmount,
              privateRpcUrl,
              skipPreflight,
            });
          }
        }
      } catch (e) {
        console.warn("Auto-rug failed:", e.message);
      }
    }

    /* Post-buy watcher: monitor LP pulls or authority flips and exit quickly */
    if (meta.postBuyWatch) {
      const { durationSec = 180, lpPullExit = true, authorityFlipExit = true } = meta.postBuyWatch;
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
            const sq = await getSwapQuote({
              inputMint: sellInputMint,
              outputMint: sellOutputMint,
              amount: sellAmount,
              slippage: 5.0,
            });
            const outAmt = sq?.outAmount ? BigInt(sq.outAmount) : null;
            if (!sq || outAmt === null || outAmt < BigInt(sellAmount) / 2n) {
              // Attempt to exit using last known quote or skip if none
              const exitQuote = sq;
              if (exitQuote) {
                try {
                  await executeSwapTurbo({
                    quote: exitQuote,
                    wallet,
                    shared,
                    priorityFee: priorityFeeLamports,
                    briberyAmount,
                    privateRpcUrl,
                    skipPreflight,
                  });
                } catch (e) {
                  /* ignore */
                }
              }
              active = false;
              clearInterval(intervalId);
              return;
            }
          }
          // Authority flip: freeze authority becomes non-null
          if (authorityFlipExit) {
            const freeze = await checkFreezeAuthority(conn, sellInputMint);
            if (freeze) {
              const exitQuote = await getSwapQuote({
                inputMint: sellInputMint,
                outputMint: sellOutputMint,
                amount: sellAmount,
                slippage: 5.0,
              });
              if (exitQuote) {
                try {
                  await executeSwapTurbo({
                    quote: exitQuote,
                    wallet,
                    shared,
                    priorityFee: priorityFeeLamports,
                    briberyAmount,
                    privateRpcUrl,
                    skipPreflight,
                  });
                } catch (e) {
                  /* ignore */
                }
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