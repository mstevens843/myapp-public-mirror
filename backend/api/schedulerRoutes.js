const express     = require("express");
const router      = express.Router();
const prisma      = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");

const {
  scheduleStrategy,   // handles both in-memory + DB insert
  cancelSchedule,     // handles timer cancel + DB delete
  updateSchedule,     // handles timer re-arm + DB update
  listSchedules,      // optional: in-memory view
} = require("../services/utils/strategy_utils/scheduler/strategyScheduler");

const validate = require("../middleware/validate");
const { csrfProtection } = require("../middleware/csrf");
const { scheduleCreateSchema } = require("./schemas/schedule.schema");

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap  = Number(defaults.cap || 500);
  let take   = parseInt(req.query?.take ?? defaults.take, 10);
  let skip   = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip <  0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}
// ─────────────────────────────────────────────────────────────────────────────
/* ────────────────────────────────────────────
 *  POST /api/schedule/create
 * ──────────────────────────────────────────── */
router.post("/create", requireAuth, csrfProtection, validate({ body: scheduleCreateSchema }), async (req, res, next) => {
  try {
    const {
      name = null,       // 🆕
      mode,
      config,
      launchISO,
      targetToken = null,
      limit       = null,
      walletLabel,
      walletId,
    } = req.body;

    /* ── resolve wallet ── */
    let resolvedWalletId = walletId;
    if (!resolvedWalletId && walletLabel) {
      const w = await prisma.wallet.findFirst({
        where : { userId: req.user.id, label: walletLabel },
        select: { id: true },
      });
      if (!w) throw new Error(`Wallet label "${walletLabel}" not found`);
      resolvedWalletId = w.id;
    }
    if (!resolvedWalletId) throw new Error("walletId (or walletLabel) is required");

    /* ── ownership check ── */
    const w = await prisma.wallet.findUnique({ where: { id: resolvedWalletId } });
    if (!w || w.userId !== req.user.id) throw new Error("Wallet does not belong to this user");

    /* ── schedule (strategyScheduler handles DB write) ── */
    const jobId = await scheduleStrategy({
      name,                              
      mode,
      config,
      launchISO,
      targetToken,
      limit,
      buyMode : config.buyMode ?? "interval",
      userId  : req.user.id,
      walletId: resolvedWalletId,
    });

    res.json({ ok: true, jobId });
  } catch (err) {
    next({ status: 400, message: err.message || "Failed to schedule" });
  }
});

/* ────────────────────────────────────────────
 *  GET /api/schedule/list
 *  (pure DB read to keep UI in sync)
 * ──────────────────────────────────────────── */
router.get("/list", requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.scheduledStrategy.findMany({
      where  : { userId: req.user.id },
      orderBy: { launchISO: "asc" },
    });
    const jobs = rows.map(({ id, ...rest }) => ({ jobId: id, ...rest }));
    res.json({ jobs });
  } catch (err) { next({ status: 400, message: err.message }); }
});

/* ────────────────────────────────────────────
 *  POST /api/schedule/cancel
 * ──────────────────────────────────────────── */
router.post("/cancel", requireAuth, async (req, res, next) => {
  try {
    const { jobId } = req.body;
    const ok = await cancelSchedule(jobId);   // handles DB delete
    res.json({ ok, jobId });
  } catch (err) { next({ status: 400, message: err.message }); }
});

/* ────────────────────────────────────────────
 *  PUT /api/schedule/update
 * ──────────────────────────────────────────── */
router.put("/update", requireAuth, async (req, res, next) => {
  try {
    const { jobId, name, ...data } = req.body; 
    await updateSchedule({ jobId, name, ...data });
    res.json({ ok: true });
  } catch (err) { next({ status: 400, message: err.message }); }
});


module.exports = router;