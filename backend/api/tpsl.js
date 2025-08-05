require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const express              = require("express");
const { v4: uuid }          = require("uuid");
const prisma                = require("../prisma/prisma");
const { getTokenBalanceRaw } = require("../utils/marketData");
const requireAuth           = require("../middleware/requireAuth");
const { PublicKey }         = require("@solana/web3.js");
const getTokenPrice     = require("../services/strategies/paid_api/getTokenPrice");

const router = express.Router();

/* ────────────── helper to resolve wallet by ID ────────────── */
async function resolveWallet(userId, walletId) {
  if (walletId) {
    const walletIdInt = parseInt(walletId, 10);
    if (!Number.isInteger(walletIdInt)) throw new Error("Invalid walletId format.");

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletIdInt, userId },
      select: { id: true, label: true, publicKey: true }
    });
    if (!wallet) throw new Error("Wallet not found or does not belong to user.");
    return wallet;
  }

  // fallback to active
  const { activeWalletId } = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWalletId: true }
  });
  if (!activeWalletId) throw new Error("No active wallet set for user.");

  const wallet = await prisma.wallet.findUnique({
    where : { id: activeWalletId },
    select: { id: true, label: true, publicKey: true }
  });
  return wallet;
}

/* ───────────────────────── GET / ───────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  const where = {
    userId: req.user.id,
    enabled: true
  };

  if (req.query.walletId) {
    const walletIdInt = parseInt(req.query.walletId, 10);
    if (Number.isInteger(walletIdInt)) where.walletId = walletIdInt;
  }

  console.log("🔍 TP/SL findMany WHERE:", where);

  try {
    const rules = await prisma.tpSlRule.findMany({
      where,
      orderBy: { createdAt: "asc" }
    });
    res.json(rules);
  } catch (err) {
    console.error("❌ Failed fetching TP/SL rules:", err.message);
    res.status(500).json({ error: "Failed to fetch TP/SL rules." });
  }
});

/* ───────────────────────── PUT /:mint ───────────────────────── */
router.put("/:mint", requireAuth, async (req, res) => {
  const { mint } = req.params;
  const {
    tp, sl, tpPercent, slPercent,
    walletId,
    force = false,
    strategy = "manual",
  } = req.body;

  const newRuleAllocation = Math.max(
    tpPercent || 0,
    slPercent || 0
  );

  if (newRuleAllocation <= 0 || newRuleAllocation > 100)
    return res.status(400).json({ error: "Must set at least one TP or SL percentage between 1-100." });

  try {
    const wallet = await resolveWallet(req.user.id, walletId);

    // 🔥 smarter aggregate: get all existing rules and sum their individual max allocation
    const existingRules = await prisma.tpSlRule.findMany({
      where: {
        userId: req.user.id,
        walletId: wallet.id,
        mint,
        strategy,
      },
      select: {
        tpPercent: true,
        slPercent: true,
        sellPct  : true
      }
    });

    const currentAllocated = existingRules.reduce((total, r) => {
      const max = Math.max(r.tpPercent || 0, r.slPercent || 0, r.sellPct || 0);
      return total + max;
    }, 0);

    if (currentAllocated + newRuleAllocation > 100) {
      return res.status(400).json({
        error: `Total TP/SL allocation would exceed 100%. Currently used: ${currentAllocated}%.`
      });
    }

    // ✅ try to get entry price
    let entryPrice = null;
    const lastTrade = await prisma.trade.findFirst({
      where: {
        mint,
        walletId: wallet.id,
        strategy,
        type: "buy"
      },
      orderBy: { timestamp: "desc" },
      select: { entryPrice: true }
    });

    if (lastTrade?.entryPrice && lastTrade.entryPrice > 0) {
      entryPrice = lastTrade.entryPrice;
      console.log(`💾 Using entryPrice from last trade: $${entryPrice}`);
    }

    if (!entryPrice || entryPrice <= 0) {
      entryPrice = await getTokenPrice(mint);
      console.log(`📈 Fallback to paid API entryPrice: $${entryPrice}`);
    }

    if (!entryPrice || entryPrice <= 0) {
      throw new Error("Failed to determine entry price from trades or paid API.");
    }

    console.log("📝 Creating TP/SL rule:", {
      userId: req.user.id,
      walletId: wallet.id,
      mint,
      strategy,
      entryPrice
    });

    const created = await prisma.tpSlRule.create({
      data: {
        id: uuid(),
        mint,
        walletId: wallet.id,
        userId: req.user.id,
        strategy,
        tp, sl,
        tpPercent: tpPercent || null,
        slPercent: slPercent || null,
        sellPct  : null,          // keeping this explicit now
        entryPrice,
        force,
        enabled: true,
      }
    });

    res.json({
      success: true,
      data: created
    });

  } catch (err) {
    console.error("❌ Failed to update TP/SL:", err.message);
    res.status(500).json({ error: "Failed to update TP/SL rule." });
  }
});




/* ─────────────────────── DELETE /:mint ─────────────────────── */
/* ───────────────────── DELETE /by-id/:id ───────────────────── */
router.delete("/by-id/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const rule = await prisma.tpSlRule.findUnique({
      where: { id }
    });

    if (!rule) {
      return res.status(404).json({ error: "No TP/SL rule found with this ID." });
    }

    // optional: check rule.userId === req.user.id
    if (rule.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to delete this rule." });
    }

    await prisma.tpSlRule.delete({
      where: { id }
    });

    console.log(`🗑 Deleted TP/SL rule by id: ${id}`);
    res.json({ success: true, message: `TP/SL rule ${id} deleted.` });
  } catch (err) {
    console.error(`❌ Failed to delete TP/SL rule by id ${id}:`, err.message);
    res.status(500).json({ error: "Failed to delete TP/SL rule." });
  }
});



// routes/trades.route.js
// GET /api/check-position?mint=xxxxx&strategy=manual
router.get("/check-position", requireAuth, async (req, res) => {
  const { mint, strategy } = req.query;
  const userId = req.user.id;

  if (!mint || !strategy) {
    return res.status(400).json({ error: "Mint and strategy required" });
  }

  try {
    // const exists = await prisma.trade.findFirst({
    //   where: {
    //     userId,
    //     mint,
    //     strategy,
    //     exitedAt: null // still open
    //   },
    // });
    const exists = await prisma.trade.findFirst({
  where: {
    mint,
    strategy,
    exitedAt: null,
    wallet: {
      userId: userId,   // ✅ indirect join through Wallet
    },
  },
});

    res.json({ exists: !!exists });
  } catch (err) {
    console.error("❌ check-position failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




module.exports = router;