// routes/orders.route.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { PublicKey } = require("@solana/web3.js");

const express        = require("express");
const { v4: uuid }   = require("uuid");
const axios          = require("axios");
const prisma         = require("../prisma/prisma");
const requireAuth    = require("../middleware/requireAuth");

const { getTokenBalanceRaw } = require("../utils/marketData");
const getTokenPrice     = require("../services/strategies/paid_api/getTokenPrice");
const { executeImmediateDcaBuy } = require("../services/dcaExecutor");
const getCachedPrice = require("../utils/priceCache.static").getCachedPrice;

const router = express.Router();

// Additional middleware for validation and CSRF protection
const validate = require("../middleware/validate");
const { csrfProtection } = require("../middleware/csrf");
const { limitOrderSchema, dcaOrderSchema } = require("./schemas/orders.schema");


function log(...msg)  { console.log(new Date().toISOString(), "[orders]", ...msg); }
function err(...msg)  { console.error(new Date().toISOString(), "[orders]", ...msg); }

/* ───────────────────────── constants ───────────────────────── */
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const API_BASE  = process.env.API_BASE || "http://localhost:5001";

/* ───────────────── helpers ─────────────────────────────────── */
async function getWallet(userId, walletLabel, walletId) {
  // ↪️  If caller omitted walletLabel → fall back to activeWalletId
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

  // ↪️  Otherwise look it up by label (scoped to user)
  const w = await prisma.wallet.findFirst({
    where: { label: walletLabel, userId },
    select: { id: true, label: true }
  });
  if (!w) throw new Error(`Wallet '${walletLabel}' not found for user.`);
  return w;
}


async function getUsdcBalance(pubkey) {
  const pk  = typeof pubkey === "string" ? new PublicKey(pubkey) : pubkey;
  const raw = await getTokenBalanceRaw(pk, USDC_MINT);
  return Number(raw) / 1e6;
}
async function getSplBalance(pubkey, mint, decimals = 9) {
  const pk  = typeof pubkey === "string" ? new PublicKey(pubkey) : pubkey;
  const raw = await getTokenBalanceRaw(pk, mint);
  return Number(raw) / 10 ** decimals;
}

/* ─────────────────────── pending endpoints ─────────────────── */
router.get("/pending-limit", requireAuth, async (req, res) => {
  const rows = await prisma.limitOrder.findMany({
    where  : { userId: req.user.id, status: { in: ["open", "executed"] }},
    orderBy: { createdAt: "asc" },
    select : {
      id: true,
      type: true,
      side: true,
      mint: true,
      price: true,
      targetPrice: true,
      amount: true,
      force: true,
      walletLabel: true,
      userId: true,
      status: true,
      createdAt: true,
      tx: true 
    }
  });
  res.json(rows.map(r => ({ ...r, type: "limit" }))); // ensure type
});

router.get("/pending-dca", requireAuth, async (req, res) => {
  const rows = await prisma.dcaOrder.findMany({
    where  : { userId: req.user.id, status: { in: ["active", "filled"] }},
    orderBy: { createdAt: "asc" },
    select : {
      id: true,
      type: true,
      side: true,
      mint: true,
      amount: true,
      unit: true,
      numBuys: true,
      totalBuys: true,
      frequency: true,
      freqHours: true,
      stopAbove: true,
      stopBelow: true,
      walletLabel: true,
      userId: true,
      force: true,
      amountPerBuy: true,
      completedBuys: true,
      executedCount: true,
      missedCount: true,
      needsFunding: true,
      status: true,
      tx: true,
      createdAt: true
    }
  });
  res.json(rows.map(r => ({ ...r, type: "dca" }))); // ensure type
});
/* ───────────────────────── POST /limit ─────────────────────── */
// Apply requireAuth, CSRF protection and schema validation before executing
router.post("/limit", requireAuth, csrfProtection, validate({ body: limitOrderSchema }), async (req, res) => {
  log("➡️  POST /limit", req.body)
  const { mint, side = "buy", targetPrice, amount,
          force = false, walletLabel, walletId } = req.body;

  if (!mint || !targetPrice || !amount)
    return res.status(400).json({ error: "mint, targetPrice, amount required" });

  /* 1️⃣ Resolve wallet: fallback to activeWalletId if walletId not given */
  let finalWalletId = walletId;
  let finalLabel    = walletLabel;
  log("💡 Initial wallet:", { finalWalletId, finalLabel });

  try {
    if (!finalWalletId) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { activeWalletId: true }
        
      });
      if (!user?.activeWalletId) {
        console.error("❌ No active wallet found for user");
        return res.status(400).json({ error: "No walletId provided and no active wallet set." });
      }
      finalWalletId = user.activeWalletId;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { id: finalWalletId },
      select: { id: true, label: true, publicKey: true }
    });
    log("💡 Resolved wallet:", wallet);

    if (!wallet) {
      console.error("❌ Wallet not found in DB for ID:", finalWalletId);
      return res.status(404).json({ error: "Wallet not found." });
    }
    finalLabel = finalLabel || wallet.label;

    /* Balance checks */
    if (side === "buy" && !force) {
      const { _sum } = await prisma.limitOrder.aggregate({
        _sum : { amount: true },
        where: {
          userId     : req.user.id,
          walletLabel: finalLabel,
          walletId   : wallet.id,
          side       : "buy",
          status     : "open"
        }
      });
      const pendingBudget = _sum.amount ?? 0;
      log("ℹ️ pendingBudget USDC", pendingBudget);

      if (await getUsdcBalance(wallet.publicKey) < (pendingBudget + +amount) * 0.95)
        return res.status(403).json({ error: "Not enough USDC to fund this order." });
    }

    if (side === "sell" && !force) {
      if (await getSplBalance(wallet.publicKey, mint) === 0)
        return res.status(403).json({
          error: "You don’t own this token – tick ‘force queue’ to override.",
          needForce: true,
        });
    }

    /** Fetch live price once, use it everywhere */
    const live  = await getTokenPrice(req.user.id, mint);

    /* 2️⃣ Build order (snapshot the current price if we got one) */
    const order = {
      id          : uuid(),
      type        : "limit",
      token       : mint,
      mint,
      price       : typeof live === "number" && Number.isFinite(live) ? live : null,
      targetPrice : +targetPrice,
      side,
      amount      : +amount,
      force,
      walletLabel : finalLabel,
      walletId    : wallet.id,
      userId      : req.user.id,
      status      : "open",
      createdAt   : new Date()
    };

    // /** 📈 Try immediate execution */
    // const live  = await getTokenPrice(req.user.id, mint);
    // log("📈 live price", live, "target", order.targetPrice);

    const liveOk = typeof live === "number" && Number.isFinite(live);
    const hit = liveOk && (
      (side === "buy"  && live <= order.targetPrice) ||
      (side === "sell" && live >= order.targetPrice)
    );

    if (hit) {
      const { data } = await axios.post(`${API_BASE}/api/manual/${side}`, {
        mint,
        amountInUSDC : amount,
        walletLabel  : finalLabel,
        walletId     : wallet.id,
        slippage     : 1.0,
        force        : true,
        strategy     : "limit",
        skipLog      : true,
        },
        {
          headers: {
            Authorization: req.headers.authorization || "", // pass same bearer token
          },
        }
      );
      

      const swap = data.result || {};
      if (!swap.tx) throw new Error("Swap returned no tx");

      await prisma.limitOrder.create({
        data: { ...order, status: "executed" }
      });

      return res.json({ success: true, order: { ...order, status: "executed" } });
    }

    /* 3️⃣ Store as open */
    const dbOrder = await prisma.limitOrder.create({ data: order });
    log("💾 order stored:", dbOrder.id, dbOrder.status);
    res.json({ success: true, order: dbOrder });

  } catch (e) {
    err("❌ limit order failed:", e);
    console.error("❌ Error in /limit handler:", e);

    res.status(500).json({ error: e.message });
  }
});









/* ───────────────────────── POST /dca ────────────────────────── */
/* ───────────────────────── POST /dca ────────────────────────── */
router.post("/dca", requireAuth, csrfProtection, validate({ body: dcaOrderSchema }), async (req, res) => {
  log("➡️  POST /dca", req.body);

  const {
    mint,
    side = "buy",
    amount,
    unit,
    numBuys,
    freqHours,
    stopAbove,
    stopBelow,
    force = false,
    walletLabel,
    walletId
  } = req.body;

  if (!mint || !amount || !unit || !numBuys || !freqHours)
    return res.status(400).json({ error: "mint, amount, unit, numBuys, freqHours required" });

  let finalWalletId = walletId;
  let finalLabel = walletLabel;

  try {
    if (!finalWalletId) {
      const { activeWalletId } = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { activeWalletId: true },
      });
      if (!activeWalletId)
        return res.status(400).json({ error: "No walletId provided and no active wallet set." });
      finalWalletId = activeWalletId;
    }

    var wallet = await prisma.wallet.findUnique({
      where: { id: finalWalletId },
      select: { id: true, label: true, publicKey: true },
    });
    if (!wallet) return res.status(404).json({ error: "Wallet not found." });
    finalLabel = finalLabel || wallet.label;
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  let needsFunding = false;
  try {
    const chunk = +amount / +numBuys;
    if (side === "buy") {
      if (unit === "usdc") {
        needsFunding = (await getUsdcBalance(wallet.publicKey)) < chunk * 0.95;
      } else {
        const solBal = await getCachedPrice(SOL_MINT);
        needsFunding = (solBal < chunk * 0.95);
      }
    } else {
      needsFunding =
        (await getSplBalance(wallet.publicKey, mint)) < (+amount / +numBuys) * 0.95;
    }
  } catch (e) {
    return res.status(500).json({ error: "Balance check failed", detail: e.message });
  }

  if (needsFunding && !force)
    return res.status(403).json({ error: "Insufficient funds to start this DCA.", needForce:true });

  const chunk = +amount / +numBuys;
  const id = uuid();

  const order = {
    id,
    type: "dca",
    side,
    mint,
    tokenMint: mint,
    amount: +amount,
    unit,
    numBuys: +numBuys,
    totalBuys: +numBuys,
    frequency: +freqHours,
    freqHours: +freqHours,
    stopAbove: stopAbove == null ? null : +stopAbove,
    stopBelow: stopBelow == null ? null : +stopBelow,
    walletLabel: finalLabel,
    walletId: wallet.id,
    userId: req.user.id,
    force,
    amountPerBuy: chunk,
    completedBuys: 0,
    executedCount: 0,
    missedCount: 0,
    needsFunding,
    status: "active",
    tx: null,
    createdAt: new Date()
  };

  await prisma.dcaOrder.create({ data: order });
  console.log(`✅ DCA order stored: ${order.id}`);

  // /* 3️⃣ optional first-leg */
  // let swapTx = null, swapFailed = false;
  // if (side === "buy" && (!needsFunding || force)) {
  //   try {
  //     const result = await executeImmediateDcaBuy(req.user.id, { ...order, amountPerBuy: chunk });
  //     swapTx = result?.tx || null;
  //     if (swapTx) {
  //       await prisma.dcaOrder.update({
  //         where: { id },
  //         data: { tx: swapTx, completedBuys: 1 }
  //       });
  //     }
  //   } catch (err) {
  //     swapFailed = true;
  //     console.error(`❌ DCA buy failed for order ${order.id}:`, err.message);
  //     // fallback: increment missedCount if we failed
  //     await prisma.dcaOrder.updateMany({
  //       where: { id },
  //       data: { missedCount: { increment: 1 } }
  //     });
  //   }
  // }

  let swapTx = null, swapFailed = false;
if (side === "buy" && (!needsFunding || force)) {
  try {
    const authHeader = req.headers.authorization;
    const result = await executeImmediateDcaBuy(req.user.id, { ...order, amountPerBuy: chunk }, authHeader);
    swapTx = result?.tx || null;
    if (swapTx) {
      await prisma.dcaOrder.update({
        where: { id },
        data: { tx: swapTx, completedBuys: 1 }
      });
    }
  } catch (err) {
    swapFailed = true;
    console.error(`❌ DCA buy failed for order ${order.id}:`, err.message);
    await prisma.dcaOrder.updateMany({
      where: { id },
      data: { missedCount: { increment: 1 } }
    });
  }
}

  res.json({
    success: true,
    order: { ...order, tx: swapTx },
    warn: needsFunding && !force
      ? "⚠️ Balance low – will execute when funded."
      : swapFailed
        ? "⚠️ First buy failed – will retry."
        : undefined
  });
});

/* ───────────────────────── DELETE /cancel/:id ──────────────── */
router.delete("/cancel/:id", requireAuth, async (req, res) => {
  const id = req.params.id;

const limit = await prisma.limitOrder.findUnique({ where: { id } });
if (limit && limit.userId === req.user.id) {
  await prisma.limitOrder.delete({
    where: { id }
  });
  return res.json({ success: true });
}


  const dca = await prisma.dcaOrder.findUnique({ where: { id } });
  if (dca && dca.userId === req.user.id) {
    await prisma.dcaOrder.update({
      where: { id },
      data: { status: "canceled" }
    });
    return res.json({ success: true });
  }

  res.status(404).json({ error: "Order not found" });
});


module.exports = router;