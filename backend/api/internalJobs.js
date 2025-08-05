const express = require("express");
const router = express.Router();
const { PublicKey } = require("@solana/web3.js");

const prisma = require("../prisma/prisma");
const { getTokenAccountsAndInfo } = require("../utils/tokenAccounts");
const getTokenPrice = require("../services/strategies/paid_api/getTokenPrice");
const getWalletBalance = require("../services/utils/wallet/walletManager").getWalletBalance;
const getCachedPrice = require("../utils/priceCache.static").getCachedPrice;
const getTokenName = require("../services/utils/analytics/getTokenName").getTokenName;
// const loadSettings = require("../telegram/utils/tpSlStorage").loadSettings;
const { performManualBuy, performManualSellByAmount, performManualSell } = require("../services/manualExecutor");
const { v4: uuid } = require("uuid");


const SOL_MINT = "So11111111111111111111111111111111111111112";

// Stable-coin mints we ignore in positions
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",  // USDH
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"  // UXD
]);

// Strict internal auth
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`) return next();
  console.log("🚫 INTERNAL route blocked. Header:", auth);
  res.status(403).json({ error: "Forbidden. Internal only." });
});

async function getWallet(userId, walletLabel) {
  if (!walletLabel) {
    const { activeWalletId } = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWalletId: true }
    });
    if (!activeWalletId) throw new Error("No active wallet set for user.");
    return prisma.wallet.findUnique({
      where: { id: activeWalletId },
      select: { id: true, label: true }
    });
  }
  const w = await prisma.wallet.findFirst({
    where: { label: walletLabel, userId },
    select: { id: true, label: true }
  });
  if (!w) throw new Error(`Wallet '${walletLabel}' not found for user.`);
  return w;
}







router.get("/positions", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const active = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWalletId: true }
    });

    let walletFilter = {};
    if (req.query.walletLabel) {
      walletFilter.label = req.query.walletLabel;
    } else if (active?.activeWalletId) {
      walletFilter.id = active.activeWalletId;
    }

    const wallet = await prisma.wallet.findFirst({
      where: { userId, ...walletFilter },
    });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for user." });

    const connWallet = { publicKey: new PublicKey(wallet.publicKey) };
    const tokenAccounts = await getTokenAccountsAndInfo(connWallet.publicKey);

    const allRows = await prisma.trade.findMany({
      where: { wallet: { userId } },
      orderBy: { timestamp: "asc" },
    });

    const openRows = allRows.filter(r =>
      BigInt(r.closedOutAmount ?? 0) < BigInt(r.outAmount ?? 0)
    );

    const solBalance = await getWalletBalance(connWallet);
    const solPrice = await getCachedPrice(SOL_MINT, { readOnly: true });

    // const settings = loadSettings();
    // const userSettings = settings[wallet.label] || {};
const tpSlRules = await prisma.tpSlRule.findMany({
  where: { userId, walletId: wallet.id, status: "active" },
});
    const userSettings = {};
    tpSlRules.forEach(rule => {
      userSettings[rule.mint] = {
        tp: rule.tp,
        sl: rule.sl,
        enabled: rule.enabled,
        entryPrice: rule.entryPrice,
      };
    });
    

    const positions = [];

    for (const { mint, name, amount } of tokenAccounts) {
      if (STABLES.has(mint) || amount < 1e-6) continue;

      const matches = openRows.filter(r => r.mint === mint);
      const totalCostSOL = matches.reduce(
        (s, r) => s + Number(r.inAmount) / 1e9, 0
      );
      const totalTokReal = matches.reduce(
        (s, r) => s + Number(r.outAmount) / 10 ** r.decimals, 0
      );
      const weightedEntry = totalTokReal
        ? +(totalCostSOL / totalTokReal).toFixed(9)
        : null;
      const totalCostUSD = matches.reduce(
        (s, r) => s + (Number(r.outAmount) / 10 ** r.decimals) * r.entryPriceUSD, 0
      );
      const entryPriceUSD = totalTokReal
        ? +(totalCostUSD / totalTokReal).toFixed(6)
        : null;

const price = await getTokenPrice(userId, mint);
      const valueUSD = +(amount * price).toFixed(2);
      const tpSl = userSettings[mint] || null;

      positions.push({
        mint,
        name: name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
        amount,
        price,
        valueUSD,
        valueSOL: +(valueUSD / solPrice).toFixed(4),
        entryPrice: weightedEntry,
        entryPriceUSD,
        inAmount: +(totalCostSOL).toFixed(6),
        strategy: matches[0]?.strategy ?? "manual",
        entries: matches.length,
        timeOpen: matches[0] ? new Date(matches[0].timestamp).toLocaleString() : null,
        tpSl: tpSl ? { tp: tpSl.tp, sl: tpSl.sl, enabled: tpSl.enabled !== false } : null,
        url: `https://birdeye.so/token/${mint}`,
      });
    }

    const seen = new Set(positions.map(p => p.mint));
    for (const r of openRows) {
      if (seen.has(r.mint) || STABLES.has(r.mint)) continue;
      const price = await getTokenPrice(userId, r.mint);
      positions.push({
        mint: r.mint,
        name: await getTokenName(r.mint) || "Unknown",
        amount: 0, price, valueUSD: 0, valueSOL: 0,
        entryPrice: null, entryPriceUSD: null,
        inAmount: 0, strategy: r.strategy,
        entries: 0, timeOpen: null,
        tpSl: null,
        url: `https://birdeye.so/token/${r.mint}`
      });
    }

    const usdcAcc = tokenAccounts.find(
      t => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    const usdcVal = usdcAcc ? usdcAcc.amount * 1 : 0;
    const solVal = solBalance * solPrice;

    res.json({
      netWorth: +(solVal + usdcVal +
        positions.reduce((s, t) => s + t.valueUSD, 0)).toFixed(2),
      sol: { amount: solBalance, price: solPrice, valueUSD: solVal },
      usdc: usdcAcc ? { amount: usdcAcc.amount, valueUSD: usdcVal } : null,
      positions
    });
  } catch (err) {
    console.error("❌ /positions error:", err);
    res.status(500).json({ error: "Failed to fetch token positions" });
  }
});


router.post("/manual/buy", async (req, res) => {
  try {
    const {
      mint,
      amountInUSDC,
      amountInSOL,
      walletLabel,
      walletId,
      slippage,
      force,
      strategy,
      skipLog
    } = req.body;

const result = await performManualBuy({
  amountInSOL,
  amountInUSDC,
  mint,
  userId: req.user.id,
  walletId: wallet.id,
  walletLabel,
  slippage,
  strategy,
  tp,
  sl,
  tpPercent,
  slPercent
}, req.headers.authorization);

    res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Internal /manual/buy failed:", err);
    res.status(500).json({ error: err.message });
  }
});




router.post("/buy", async (req, res) => {
  let {
    amountInSOL, amountInUSDC, mint, force, walletLabel,
    slippage, strategy, tp, sl, tpPercent, slPercent, userId
  } = req.body;

  try {
    const wallet = await getWallet(userId, walletLabel);
    if (!walletLabel) walletLabel = wallet.label;

    const result = await performManualBuy({
      amountInSOL, amountInUSDC, mint, userId,
      walletId: wallet.id, walletLabel, slippage,
      strategy, tp, sl, tpPercent, slPercent
    });

    if (tp != null || sl != null) {
      await prisma.tpSlRule.create({
        data: {
          id: uuid(), mint, walletId: wallet.id, userId,
          strategy, tp, sl, tpPercent, slPercent,
          entryPrice: result.entryPrice, force: false,
          enabled: true, status: "active", failCount: 0,
        },
      });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error("❌ INTERNAL /buy error:", err);
    return res.status(500).json({ error: err.message || "Manual buy failed." });
  }
});

router.post("/sell", async (req, res) => {
  let { percent, amount, strategy = "manual", mint,
        walletLabel, slippage, triggerType, force, userId } = req.body;

  try {
    const wallet = await getWallet(userId, walletLabel);
    if (!walletLabel) walletLabel = wallet.label;

    if (amount && +amount > 0) {
      const result = await performManualSellByAmount({
        amount, mint, strategy, userId,
        walletId: wallet.id, walletLabel, slippage
      });
      return res.json({ success: true, result });
    }

    percent = parseFloat(percent);
    if (percent > 1) percent /= 100;
    if (percent <= 0 || percent > 1) {
      return res.status(400).json({ error: "Sell percent must be between 0.01 and 1.0" });
    }

    const result = await performManualSell({
      percent, mint, strategy, userId,
      walletId: wallet.id, walletLabel, slippage, triggerType
    });

    return res.json({ success: true, result });
  } catch (err) {
    console.error("❌ INTERNAL /sell error:", err);
    return res.status(500).json({ error: err.message || "Manual sell failed." });
  }
});






module.exports = router;
