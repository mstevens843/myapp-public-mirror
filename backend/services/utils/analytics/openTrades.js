/* Open-Trades helper
 * ──────────────────────────────────────────────────────────────
 * • Keeps open-trades.json & closed-trades.json in sync
 * • Adds side:"buy" | "sell" so the UI can rely on a single field
 */

// services/utils/analytics/openTrades.js
// ✅ DB-backed Open-Trade helper – July 2025
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"
]);

/**
 * Insert or merge an open-trade row.
 * • Assumes 1 row per {mint, strategy, walletLabel} that is still open.
 * • For multiple DCAs into the same position we increment in/out amounts.
 */
async function addOrUpdateOpenTrade(opts) {
  const {
    mint,
    inAmount,
    outAmount,
    entryPrice,
    entryPriceUSD,
    strategy,
    walletLabel,
    walletId,
    slippage,
    decimals,
    usdValue,
    txHash,
    unit,
  } = opts;

  // 🚫 1. Skip stables entirely
  if (STABLES.has(mint)) {
    console.log(`🚫 Skipping open trade insert for stable mint: ${mint}`);
    return;
  }

    // 🔁 Prefer walletId if available, else resolve from label
let resolvedWalletId = walletId;
let resolvedLabel = walletLabel;

// 🧠 If walletId is missing, fallback to walletLabel lookup
if (!resolvedWalletId && walletLabel) {
  console.warn("⚠️ Falling back to walletLabel lookup — walletId was missing!");
  const wallet = await prisma.wallet.findFirst({
    where: { label: walletLabel },
    select: { id: true },
  });
  if (!wallet) throw new Error(`Wallet label '${walletLabel}' not found in DB`);
  resolvedWalletId = wallet.id;
}

// 🧠 If walletLabel is missing, try to resolve from walletId
if (!resolvedLabel && walletId) {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { label: true },
  });
  if (!wallet) throw new Error(`Wallet ID '${walletId}' not found in DB`);
  resolvedLabel = wallet.label;
}

// 🛑 Enforce at least one resolved
if (!resolvedWalletId || !resolvedLabel) {
  throw new Error(`❌ Missing both walletId and walletLabel — cannot proceed.`);
}

// ✅ FINAL LOG — what we’re actually using
console.log("🧩 [openTrades] Using wallet ID + Label:", {
  usedWalletId: resolvedWalletId,
  usedWalletLabel: resolvedLabel,
});


  // 3. check for existing open row
  const existing = await prisma.trade.findFirst({
    where: {
      mint,
      strategy,
      walletId: resolvedWalletId,
      exitedAt: null,
    },
  });

  if (existing) {
    await prisma.trade.update({
      where: { id: existing.id },
      data: {
        inAmount:  { increment: BigInt(inAmount) },
        outAmount: { increment: BigInt(outAmount) },
        closedOutAmount: existing.closedOutAmount ?? BigInt(0),
        usdValue,
        slippage,
        updatedAt: new Date(),
        ...(existing.entryPrice == null && { entryPrice }),
        ...(existing.entryPriceUSD == null && { entryPriceUSD }),
      },
    });
    return existing.id;
  }

  /**
   * 🔔 Optional polish for later (not required):
js
Copy
Edit
// Could inline this in the `await prisma.wallet...` call
if (!resolvedWalletId && !resolvedLabel) {
  throw new Error(`❌ Must provide walletId or walletLabel`);
}

   */

  // 4. create fresh row
  await prisma.trade.create({
    data: {
      mint,
      tokenName: null,
      entryPrice,
      entryPriceUSD,
      inAmount: BigInt(inAmount),
      outAmount: BigInt(outAmount),
      closedOutAmount: BigInt(0),
      strategy,
      walletLabel: resolvedLabel,
      txHash,
      unit,
      slippage,
      decimals,
      usdValue,
      type: "buy",
      side: "long",
      botId: strategy,
      triggerType: null,
      walletId: resolvedWalletId,
    },
  });
}

module.exports = { addOrUpdateOpenTrade };


