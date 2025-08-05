// routes/prefs.route.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const router       = require("express").Router();
const prisma       = require("../prisma/prisma");
const requireAuth  = require("../middleware/requireAuth");

router.use(requireAuth);

/* GET /api/prefs/:ctx? */
router.get("/:ctx?", async (req, res) => {
  const ctx = req.params.ctx || "default";
  try {
    const row = await prisma.userPreference.findUnique({
      where: { userId_context: { userId: req.user.id, context: ctx } },
    });
    return res.json(row ?? {});
  } catch (err) {
    console.error("prefs GET error:", err);
    res.status(500).json({ error: "prefs read failed" });
  }
});

/* PUT /api/prefs/:ctx? */
router.put("/:ctx?", async (req, res) => {
  const ctx = req.params.ctx || "default";
  try {
    const {
      defaultMaxSlippage,
      defaultPriorityFee,
      confirmBeforeTrade,
      alertsEnabled,
      slippage,
      autoBuy = {},
      mevMode,
      briberyAmount,
    } = req.body;

    const patch = {
      ...(mevMode            !== undefined && { mevMode }),
      ...(briberyAmount      !== undefined && { briberyAmount: Number(briberyAmount) }),
      ...(confirmBeforeTrade !== undefined && { confirmBeforeTrade }),
      ...(alertsEnabled      !== undefined && { alertsEnabled }),
      ...(slippage           !== undefined && { slippage: Number(slippage) }),
      ...(autoBuy.enabled    !== undefined && { autoBuyEnabled: !!autoBuy.enabled }),
      ...(autoBuy.amount     !== undefined && { autoBuyAmount: Number(autoBuy.amount) }),
      ...(defaultMaxSlippage !== undefined && { defaultMaxSlippage: Number(defaultMaxSlippage) }),
      ...(defaultPriorityFee !== undefined && { defaultPriorityFee: parseInt(defaultPriorityFee) }),
    };

    const row = await prisma.userPreference.upsert({
      where : { userId_context: { userId: req.user.id, context: ctx } },
      update: patch,
      create: { userId: req.user.id, context: ctx, ...patch },
    });

    res.json(row);   // ← return the latest document
  } catch (err) {
    console.error("prefs PUT error:", err);
    res.status(500).json({ error: "prefs write failed" });
  }
});

module.exports = router;
