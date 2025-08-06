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

const prisma = require("../../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair, Connection, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");
const {
  executeSwapTurbo,
  getSwapQuote,
} = require("../../../utils/swap");
const { getMintDecimals } = require("../../../utils/tokenAccounts");
const getTokenPrice = require("../paid_api/getTokenPrice");
const getSolPrice = getTokenPrice.getSolPrice;
const { sendAlert } = require("../../../telegram/alerts");
const { trackPendingTrade } = require("./txTracker");

// 🔐  Arm / envelope-crypto helpers
const { getDEK } = require("../../../../core/crypto/sessionKeyCache");
const {
  decryptPrivateKeyWithDEK,
} = require("../../../crypto/envelopeCrypto");
const { decrypt } = require("../../../../middleware/auth/encryption");

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

  /* ——— 1️⃣  Turbo swap (blocking) ——— */
  let txHash = null;
  if (!simulated) {
    txHash = await executeSwapTurbo({
      quote,
      wallet,
      shared,
      priorityFee: priorityFeeLamports,
      briberyAmount,
      privateRpcUrl,
      skipPreflight,
    });
    if (!txHash)
      throw new Error("swap-failed: executeSwapTurbo() returned null");
    trackPendingTrade(txHash, mint, strategy);
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
  })().catch(console.error);

  /* ——— 5️⃣  Done ——— */
  return txHash;
}

module.exports = execTrade;
