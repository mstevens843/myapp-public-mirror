/* core/tradeExecutor.js */
const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { executeSwap }          = require("../../../utils/swap");
const { getMintDecimals }      = require("../../../utils/tokenAccounts");
const  getTokenPrice        = require("../paid_api/getTokenPrice");
const getSolPrice               = getTokenPrice.getSolPrice;
const { sendAlert }            = require("../../../telegram/alerts");
const { trackPendingTrade }    = require("./txTracker"); // NEW
const { decrypt } = require("../../../middleware/auth/encryption");

async function loadWalletKeypair(walletId) {
  const row = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { privateKey: true }
  });
  if (!row) throw new Error("Wallet not found in DB.");
  const secret = decrypt(row.privateKey);
  return Keypair.fromSecretKey(bs58.decode(secret.trim()));
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const toNum = (v) => (v === undefined || v === null ? null : Number(v));




async function execTrade({
  quote,
  mint,
  meta,
  simulated = false,
}) {
  const {
  strategy,
    // walletLabel: walletRow.label,
  category        = strategy,
  tp, sl, tpPercent, slPercent,  
  slippage        = 0,
  // openTradeExtras = {},
  userId,
  walletId,
} = meta;


  console.log("🧩 META RECEIVED:", { walletId, userId });

    const wallet = await loadWalletKeypair(walletId);
console.log(`🔑 Loaded wallet pubkey from DB: ${wallet.publicKey.toBase58()}`);

  // ⬇️ Global MEV prefs (from userPreference)
  const userPrefs = await prisma.userPreference.findUnique({
    where: {
      userId_context: {
        userId,
        context: "default",
      },
    },
    select: {
      mevMode: true,
      briberyAmount: true,
      defaultPriorityFee: true,
    },
  });

  const mevMode       = userPrefs?.mevMode || "fast";
  const briberyAmount = userPrefs?.briberyAmount ?? 0;
  const shared        = mevMode === "secure";
  /* pick cfg‑level value > user default > 0 */
  const priorityFeeLamports =
    toNum(meta.priorityFeeLamports) ??
    toNum(userPrefs?.defaultPriorityFee) ??
    0;

  console.log("🛡️ Using MEV prefs:", { mevMode, shared, briberyAmount, priorityFeeLamports });


  let txHash = null;
  if (!simulated) {
    try {
      console.log("🔁 Executing live swap…");
        txHash = await executeSwap({
          quote,
          wallet,
          shared,
          priorityFee: priorityFeeLamports,   // NEW
          briberyAmount,
        });

if (!txHash) throw new Error("swap-failed: executeSwap() returned null");
      trackPendingTrade(txHash, mint, strategy);
    } catch (err) {
      console.error("❌ Swap failed:", err.message);
      throw new Error(`swap-failed: ${err.message || err}`);
    }
  }

  /* 2️⃣  enrichment */
  let entryPriceUSD = null, usdValue = null, entryPrice = null, decimals = null;


  try {
  //   decimals    = await getMintDecimals(mint);
  //  entryPrice = (Number(quote.inAmount) * 10 ** decimals) / (Number(quote.outAmount) * 1e9);
  const inDec  = await getMintDecimals(quote.inputMint);
  const outDec = await getMintDecimals(quote.outputMint);

  const inUi   = Number(quote.inAmount)  / 10 ** inDec;
  const outUi  = Number(quote.outAmount) / 10 ** outDec;

  decimals     = outDec;        // keep for amount/outAmount formatting
  entryPrice   = inUi / outUi;  // price of *output* token in *input* units
    // const baseUsd = await getTokenPrice(userId || null, quote.inputMint);
  const baseUsd = await getTokenPrice(userId || null, quote.inputMint) ||
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
  select: { id: true, label: true }
});

if (!walletRow || !walletRow.label) {
  throw new Error(`walletLabel not found for walletId ${walletId}`);
}

const walletLabel = walletRow.label;

  const safeJson = (data) =>
  JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

  console.log("🧩 TRADE.create payload:");
console.log(safeJson({
  mint,
  entryPrice,
  entryPriceUSD,
  inAmount: BigInt(quote.inAmount),
  outAmount: BigInt(quote.outAmount),
  closedOutAmount: BigInt(0),
  strategy,
  txHash,
  // unit: quote.inputMint === SOL_MINT ? "sol" : "usdc",
      unit:
        quote.inputMint === SOL_MINT ? "sol"
      : quote.inputMint === USDC_MINT ? "usdc"
      : "spl",
  slippage,
  decimals,
  usdValue,
  type: "buy",
  side: "buy",
  // botId: strategy,
  botId: meta.botId || strategy,
  walletId,
    walletLabel,
      mevMode,
      priorityFee   : priorityFeeLamports,
      briberyAmount,
      mevShared     : shared,
}, null, 2));

console.log("🧩 FINAL WALLET ID TYPE:", typeof walletId, walletId);

// 🛑 Check for recent duplicate trade before saving
const recent = await prisma.trade.findFirst({
  where: {
    mint,
    walletId,
    strategy,
    timestamp: {
      gte: new Date(Date.now() - 5000) // only trades in last 5 seconds
    }
  }
});

if (recent) {
  console.warn(`🛑 Skipping duplicate trade for ${mint} — already exists`);
  return;
}


try {
  await prisma.trade.create({
    data: {
      mint,
      tokenName: meta.tokenName ?? null,
      entryPrice,
      entryPriceUSD,
      inAmount: BigInt(quote.inAmount),
      outAmount: BigInt(quote.outAmount),
      closedOutAmount: BigInt(0),
      strategy,
      txHash,
      unit:
        quote.inputMint === SOL_MINT ? "sol"
      : quote.inputMint === USDC_MINT ? "usdc"
      : "spl",     
      slippage,
      decimals,
      usdValue,
      type: "buy",
      side: "buy",
      botId: strategy,
      walletId,
      walletLabel,
      mevMode,
      priorityFee   : priorityFeeLamports,
      briberyAmount,
      mevShared     : shared,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
    },
  });

  console.log("✅ TRADE SAVED SUCCESSFULLY");
} catch (err) {
  console.error("❌ TRADE SAVE FAILED:", err?.message || err);
  console.dir(err, { depth: null });
}
  
    console.log("🧪 Checking TP/SL eligibility with:", { tp, sl, tpPercent, slPercent });

    /* ── create TP/SL rule if needed ────────────── */
const skipTpSl = ["rotationbot", "rebalancer"].includes((strategy || "").toLowerCase());

if (!skipTpSl && ((Number(tp) || 0) !== 0 || (Number(sl) || 0) !== 0)) {
  console.log("📝 Creating TP/SL rule with:", { tp, sl, tpPercent, slPercent });
  await prisma.tpSlRule.create({
        data: {
          id: uuid(),
          mint,
          walletId,
          userId,
          strategy,
          tp, sl, tpPercent, slPercent, 
          // entryPrice: entryPriceSOL,
          entryPrice: entryPrice,
          force: false,
          enabled: true,
          status: "active",
          failCount: 0,
        }
      });
    }


  /* 6️⃣  alert */
  const amountFmt = (quote.outAmount / 10 ** decimals).toFixed(4);
  const impactFmt = (quote.priceImpactPct * 100).toFixed(2) + "%";
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

  return txHash;
}


const liveBuy     = (o) => execTrade({ ...o, simulated: false });
const simulateBuy = (o) => execTrade({ ...o, simulated: true  });

module.exports = { liveBuy, simulateBuy };
