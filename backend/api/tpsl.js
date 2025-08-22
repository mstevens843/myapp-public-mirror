require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const express              = require("express");
const { v4: uuid }          = require("uuid");
const prisma                = require("../prisma/prisma");
const { getTokenBalanceRaw } = require("../utils/marketData");
const requireAuth           = require("../middleware/requireAuth");
const { PublicKey }         = require("@solana/web3.js");
const getTokenPrice     = require("../services/strategies/paid_api/getTokenPrice");

const router = express.Router();

// Import job runner for idempotent rule creation
const { runJob } = require("../services/jobs/jobRunner");

const validate = require("../middleware/validate");
const { csrfProtection } = require("../middleware/csrf");
const { ruleSchema } = require("./schemas/tpsl.schema");

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
    // Allow pagination via ?take and ?skip. Defaults to returning up to 100
    // active rules. Hard cap of 500 to avoid returning excessively large
    // result sets.
    let { take = 100, skip = 0 } = req.query;
    take = Math.min(parseInt(take, 10) || 100, 500);
    skip = Math.max(parseInt(skip, 10) || 0, 0);
    const rules = await prisma.tpSlRule.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take,
      skip,
    });
    res.json(rules);
  } catch (err) {
    console.error("❌ Failed fetching TP/SL rules:", err.message);
    res.status(500).json({ error: "Failed to fetch TP/SL rules." });
  }
});

/* ───────────────────────── PUT /:mint ───────────────────────── */
// Legacy non‑idempotent TP/SL rule endpoint. Use PUT /api/tpsl/:mint instead for idempotent behaviour.
router.put("/:mint-old", requireAuth, csrfProtection, validate({ body: ruleSchema }), async (req, res) => {
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
      const max = Math.max(r.tpPercent || 0, r.slPercent || 0);
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







router.put("/by-id/:id", requireAuth, csrfProtection, async (req, res) => {
  const { id } = req.params;
  const { tp, sl, tpPercent, slPercent, strategy } = req.body || {};

  try {
    const rule = await prisma.tpSlRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ error: "No TP/SL rule found with this ID." });
    if (rule.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to edit this rule." });
    }

    const newAlloc = Math.max(tpPercent || 0, slPercent || 0);
    if (newAlloc <= 0 || newAlloc > 100) {
      return res
        .status(400)
        .json({ error: "Must set at least one TP or SL percentage between 1-100." });
    }

    // Sum allocation of all *other* rules for this (user, wallet, mint, strategy)
    const otherRules = await prisma.tpSlRule.findMany({
      where: {
        userId: req.user.id,
        walletId: rule.walletId,
        mint: rule.mint,
        strategy: strategy || rule.strategy,
        NOT: { id },
      },
      select: { tpPercent: true, slPercent: true, sellPct: true },
    });

    const allocated = otherRules.reduce((total, r) => {
      const max = Math.max(r.tpPercent || 0, r.slPercent || 0);
      return total + max;
    }, 0);

    if (allocated + newAlloc > 100) {
      return res
        .status(400)
        .json({ error: `Total TP/SL allocation would exceed 100%. Currently used: ${allocated}%.` });
    }

    const updated = await prisma.tpSlRule.update({
      where: { id },
      data: {
        tp: tp ?? null,
        sl: sl ?? null,
        tpPercent: tpPercent ?? null,
        slPercent: slPercent ?? null,
        sellPct: null, // keep explicit; allocation comes from tp/sl percents
        strategy: strategy || rule.strategy,
        // entryPrice unchanged
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("❌ Failed to edit TP/SL:", err);
    res.status(500).json({ error: "Failed to edit TP/SL rule." });
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

// -----------------------------------------------------------------------------
// Idempotent TP/SL rule creation. This handler wraps the legacy logic in the
// job runner so that repeated requests with the same Idempotency-Key do not
// create duplicate TP/SL rules. The legacy handler remains available at
// `PUT /tpsl/:mint-old`.
router.put("/:mint", requireAuth, csrfProtection, validate({ body: ruleSchema }), async (req, res) => {
  const idKey = req.get('Idempotency-Key') || req.headers['idempotency-key'] || null;
  try {
    const jobResult = await runJob(idKey, async () => {
      const { mint } = req.params;
      const {
        tp,
        sl,
        tpPercent,
        slPercent,
        walletId,
        force = false,
        strategy = "manual",
      } = req.body;
      const newRuleAllocation = Math.max(tpPercent || 0, slPercent || 0);
      if (newRuleAllocation <= 0 || newRuleAllocation > 100) {
        return { status: 400, response: { error: "Must set at least one TP or SL percentage between 1-100." } };
      }
      try {
        const wallet = await resolveWallet(req.user.id, walletId);
        // Aggregate existing TP/SL rules to ensure allocation doesn’t exceed 100%
        const existingRules = await prisma.tpSlRule.findMany({
          where: {
            userId: req.user.id,
            walletId: wallet.id,
            mint,
            strategy,
          },
          select: { tpPercent: true, slPercent: true, sellPct: true }
        });
        const currentAllocated = existingRules.reduce((total, r) => {
          const max = Math.max(r.tpPercent || 0, r.slPercent || 0);
          return total + max;
        }, 0);
        if (currentAllocated + newRuleAllocation > 100) {
          return { status: 400, response: { error: `Total TP/SL allocation would exceed 100%. Currently used: ${currentAllocated}%.` } };
        }
        // Determine entry price from last trade or fallback to paid API
        let entryPrice = null;
        const lastTrade = await prisma.trade.findFirst({
          where: {
            mint,
            walletId: wallet.id,
            strategy,
            type: "buy",
          },
          orderBy: { timestamp: "desc" },
          select: { entryPrice: true }
        });
        if (lastTrade?.entryPrice && lastTrade.entryPrice > 0) {
          entryPrice = lastTrade.entryPrice;
        }
        if (!entryPrice || entryPrice <= 0) {
          entryPrice = await getTokenPrice(mint);
        }
        if (!entryPrice || entryPrice <= 0) {
          return { status: 500, response: { error: "Failed to determine entry price from trades or paid API." } };
        }
        const created = await prisma.tpSlRule.create({
          data: {
            id: uuid(),
            mint,
            walletId: wallet.id,
            userId: req.user.id,
            strategy,
            tp,
            sl,
            tpPercent: tpPercent || null,
            slPercent: slPercent || null,
            sellPct: null,
            entryPrice,
            force,
            enabled: true,
          }
        });
        return { status: 200, response: { success: true, data: created } };
      } catch (err) {
        console.error("❌ Failed to update TP/SL:", err.message);
        return { status: 500, response: { error: "Failed to update TP/SL rule." } };
      }
    });
    res.status(jobResult.status || 200).json(jobResult.response || {});
  } catch (err) {
    console.error("❌ Error in idempotent TP/SL handler:", err);
    res.status(500).json({ error: err.message || "Failed to update TP/SL rule." });
  }
});



// routes/trades.route.js
// /api/tpsl/check-position
router.get("/check-position", requireAuth, async (req, res) => {
  const { mint, strategy = "manual" } = req.query;
  const userId = req.user.id;
  if (!mint || !strategy) return res.status(400).json({ error: "Mint and strategy required" });

  try {
    const trades = await prisma.trade.findMany({
      where: {
        mint,
        strategy,
        exitedAt: null,
        type: "buy",
        side: "buy",
        wallet: { userId },
        NOT: { strategy: "import" }, // ignore bookkeeping rows
      },
      select: { outAmount: true, closedOutAmount: true, decimals: true },
    });

    // consider dust as "not holding"
    const DUST_BPS = 50; // 0.50%
    const ABS_DUST = (d = 9) => (d >= 9 ? 10_000n : 1_000n);

    const live = trades.some((t) => {
      const out = BigInt(t.outAmount ?? 0);
      const closed = BigInt(t.closedOutAmount ?? 0);
      const remaining = out > closed ? out - closed : 0n;
      if (remaining === 0n) return false;

      const isDustRel = out > 0n && (remaining * 10_000n) <= (out * BigInt(DUST_BPS));
      const isDustAbs = remaining <= ABS_DUST(t.decimals ?? 9);
      return !(isDustRel || isDustAbs);
    });

    res.json({ exists: live });
  } catch (err) {
    console.error("❌ check-position failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



module.exports = router;