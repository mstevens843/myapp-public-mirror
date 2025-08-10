/* core/tradeExecutor.js
 * Arm-aware trade executor: uses in-memory DEK (no latency) when armed,
 * enforces Protected Mode when required, and falls back to legacy decrypt
 * only when allowed (non-protected wallets).
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

// 🔐 NEW: Arm session + envelope decrypt
const { getDEK } = require("../../../armEncryption/sessionKeyCache");              // <-- ADD
const { decryptPrivateKeyWithDEK } = require("../../../armEncryption/envelopeCrypto"); // <-- ADD

// 🔐 Legacy env-key encrypt/decrypt (your current helper)
const { decrypt } = require("../../../middleware/auth/encryption");

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const toNum = (v) => (v === undefined || v === null ? null : Number(v));

/**
 * 🔑 NEW: Arm-aware wallet loader
 * Priority:
 *  1) If wallet.encrypted (envelope v1) exists:
 *      - require an armed session (DEK present in memory) if wallet.isProtected = true
 *      - use decryptPrivateKeyWithDEK(blob, DEK, aad) (zero latency)
 *  2) Else (legacy path):
 *      - decrypt(row.privateKey) → base58 → Keypair
 */
async function loadWalletKeypairArmAware(userId, walletId) { // <-- REPLACE callers to pass userId too
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, encrypted: true, isProtected: true, privateKey: true }
  });
  if (!wallet) throw new Error("Wallet not found in DB.");

  const aad = `user:${userId}:wallet:${walletId}`; // <-- AAD from context (DO NOT trust blob)

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
      // If not protected and not required to Arm, we still cannot decrypt an envelope without KEK.
      // So we *must* block here to avoid silently failing.
      const err = new Error("Protected wallet requires an armed session");
      err.status = 401;
      err.code = "AUTOMATION_NOT_ARMED";
      throw err;
    }

    // Fast path: decrypt with DEK in memory (no network/KMS)
    const pkBuf = decryptPrivateKeyWithDEK(wallet.encrypted, dek, aad);
    try {
      // Expect 64-byte secret key
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
    // AAD is accepted by your helper but legacy colon-hex ignores it; safe to pass.
    const secretBase58 = decrypt(wallet.privateKey, { aad });
    try {
      const secretBytes = bs58.decode(secretBase58.trim());
      if (secretBytes.length !== 64) throw new Error("Invalid secret key length after legacy decryption");
      return Keypair.fromSecretKey(secretBytes);
    } finally {
      // best-effort wipe local copies
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
  } = meta;

  if (!userId || !walletId) throw new Error("userId and walletId are required in meta");

  console.log("🧩 META RECEIVED:", { walletId, userId });

  // 🔑 LOAD KEYPAIR (Arm-aware)
  let wallet;
  try {
    wallet = await loadWalletKeypairArmAware(userId, walletId); // <-- USE NEW LOADER
  } catch (err) {
    // Bubble up an HTTP-friendly 401 so your API layer can map it to the frontend (to pop the Arm modal)
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
  if (!simulated) {
    try {
      console.log("🔁 Executing live swap…");
      txHash = await executeSwap({
        quote,
        wallet,
        shared,
        priorityFee: priorityFeeLamports,
        briberyAmount,
      });
      if (!txHash) throw new Error("swap-failed: executeSwap() returned null");
      trackPendingTrade(txHash, mint, strategy);
    } catch (err) {
      console.error("❌ Swap failed:", err.message);
      throw new Error(`swap-failed: ${err.message || err}`);
    }
  }

  /* Enrichment */
  let entryPriceUSD = null, usdValue = null, entryPrice = null, decimals = null;
  try {
    const inDec  = await getMintDecimals(quote.inputMint);
    const outDec = await getMintDecimals(quote.outputMint);
    const inUi   = Number(quote.inAmount)  / 10 ** inDec;
    const outUi  = Number(quote.outAmount) / 10 ** outDec;

    decimals     = outDec;
    entryPrice   = inUi / outUi;

    const baseUsd =
      (await getTokenPriceModule(userId || null, quote.inputMint)) ||
      (quote.inputMint === SOL_MINT ? await getSolPrice(userId) : null);

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

  // Deduplicate recent trade
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
    // Attempt to scale the in/out amounts proportionally.  Fallback to
    // the original quote if BigInt math fails.
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
    // Call risk hooks if provided; ignore any errors or return values.
    try {
      const risk = meta && meta.riskPolicy;
      if (risk) {
        if (typeof risk.nextStop === 'function') risk.nextStop(meta.position || {});
        if (typeof risk.shouldExit === 'function') risk.shouldExit(meta.position || {}, {});
      }
    } catch {}
    // Execute the partial order using the same live swap path.  Note
    // that simulateBuy uses the same interface and will be chosen
    // upstream by the strategy when DRY_RUN is enabled.
    lastTx = await liveBuy({ ...opts, quote: partialQuote });
    // Introduce a small delay (100ms) to stagger slices.  Using
    // setTimeout via Promise avoids blocking the event loop.
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