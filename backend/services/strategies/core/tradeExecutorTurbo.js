/* core/tradeExecutor.js
 * Extended to support turbo mode AND Arm-to-Trade (envelope crypto + in-memory DEK).
 * Zero added latency on the hot path.
 */

const prisma = require("../../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { executeSwap, executeSwapTurbo } = require("../../../../utils/swap");
const { getMintDecimals } = require("../../../../utils/tokenAccounts");
const getTokenPrice = require("../paid_api/getTokenPrice");
const getSolPrice = getTokenPrice.getSolPrice;
const { sendAlert } = require("../../../../telegram/alerts");
const { trackPendingTrade } = require("./txTracker");

// 🔐 Arm session + envelope decrypt
const { getDEK } = require("../../../../core/crypto/sessionKeyCache");
const { decryptPrivateKeyWithDEK } = require("../../../../core/crypto/envelopeCrypto");

// 🔐 Legacy decrypt (colon-hex / env-key)
const { decrypt } = require("../../../../middleware/auth/encryption");

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const toNum = (v) => (v === undefined || v === null ? null : Number(v));

/** Arm-aware key loader */
async function loadWalletKeypairArmAware(userId, walletId) {
  const row = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { encrypted: true, isProtected: true, privateKey: true },
  });
  if (!row) throw new Error("Wallet not found in DB.");

  const aad = `user:${userId}:wallet:${walletId}`;

  // Envelope path (preferred)
  if (row.encrypted && row.encrypted.v === 1) {
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
      // Not protected but has envelope → still can’t decrypt without DEK/KEK
      const err = new Error("Protected wallet requires an armed session");
      err.status = 401;
      err.code = "AUTOMATION_NOT_ARMED";
      throw err;
    }
    const pkBuf = decryptPrivateKeyWithDEK(row.encrypted, dek, aad);
    try {
      if (pkBuf.length !== 64) throw new Error(`Unexpected secret key length: ${pkBuf.length}`);
      return Keypair.fromSecretKey(new Uint8Array(pkBuf));
    } finally {
      pkBuf.fill(0);
    }
  }

  // Legacy path (string -> base58 -> bytes)
  if (row.privateKey) {
    const secretBase58 = decrypt(row.privateKey, { aad }); // legacy ignores AAD but safe to pass
    const secretBytes = bs58.decode(secretBase58.trim());
    if (secretBytes.length !== 64) throw new Error("Invalid secret key length after legacy decryption");
    return Keypair.fromSecretKey(secretBytes);
  }

  throw new Error("Wallet has no usable key material");
}

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
    turboMode = false,
    privateRpcUrl,
    skipPreflight = true,
  } = meta;

  if (!userId || !walletId) throw new Error("userId and walletId are required in meta");

  console.log(" META RECEIVED:", { walletId, userId });

  // 🔑 LOAD KEYPAIR (Arm-aware)
  let wallet;
  try {
    wallet = await loadWalletKeypairArmAware(userId, walletId);
  } catch (err) {
    if (err.status === 401 || err.code === "AUTOMATION_NOT_ARMED") {
      err.expose = true; // let the HTTP handler map to 401 for the Arm modal
    }
    throw err;
  }

  console.log(` Loaded wallet pubkey from DB: ${wallet.publicKey.toBase58()}`);

  const userPrefs = await prisma.userPreference.findUnique({
    where: { userId_context: { userId, context: "default" } },
    select: { mevMode: true, briberyAmount: true, defaultPriorityFee: true },
  });

  const mevMode       = userPrefs?.mevMode || "fast";
  const briberyAmount = userPrefs?.briberyAmount ?? 0;
  const shared        = mevMode === "secure";
  const priorityFeeLamports =
    toNum(meta.priorityFeeLamports) ?? toNum(userPrefs?.defaultPriorityFee) ?? 0;

  console.log("️ Using MEV prefs:", { mevMode, shared, briberyAmount, priorityFeeLamports });

  let txHash = null;
  if (!simulated) {
    try {
      console.log(" Executing live swap…");
      if (turboMode) {
        txHash = await executeSwapTurbo({
          quote,
          wallet,
          shared,
          priorityFee: priorityFeeLamports,
          briberyAmount,
          privateRpcUrl,
          skipPreflight,
        });
      } else {
        txHash = await executeSwap({
          quote,
          wallet,
          shared,
          priorityFee: priorityFeeLamports,
          briberyAmount,
        });
      }
      if (!txHash) throw new Error("swap-failed: executeSwap() returned null");
      trackPendingTrade(txHash, mint, strategy);
    } catch (err) {
      console.error("❌ Swap failed:", err.message);
      throw new Error(`swap-failed: ${err.message || err}`);
    }
  }

  // Enrichment
  let entryPriceUSD = null, usdValue = null, entryPrice = null, decimals = null;
  try {
    const inDec  = await getMintDecimals(quote.inputMint);
    const outDec = await getMintDecimals(quote.outputMint);
    const inUi   = Number(quote.inAmount)  / 10 ** inDec;
    const outUi  = Number(quote.outAmount) / 10 ** outDec;
    decimals     = outDec;
    entryPrice   = inUi / outUi;

    const baseUsd =
      (await getTokenPrice(userId || null, quote.inputMint)) ||
      (quote.inputMint === SOL_MINT ? await getSolPrice(userId) : null);

    entryPriceUSD = baseUsd ? entryPrice * baseUsd : null;
    usdValue      = baseUsd ? +((quote.inAmount / 1e9) * baseUsd).toFixed(2) : null;

    console.log(" Enrichment done:", { entryPrice, entryPriceUSD, usdValue });
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
  console.log(" TRADE.create payload:");
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
        quote.inputMint === SOL_MINT
          ? "sol"
          : quote.inputMint === USDC_MINT
          ? "usdc"
          : "spl",
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
    }, null, 2)
  );

  const recent = await prisma.trade.findFirst({
    where: {
      userId,
      mint,
      strategy,
      type: "buy",
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 1) },
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
    },
  });

  return txHash;
}

module.exports = execTrade;
