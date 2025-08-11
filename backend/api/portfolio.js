/**
 * Portfolio routes – per-user, Prisma-backed
 * ───────────────────────────────────────────
 *  /api/portfolio/history   → daily + monthly
 *  /api/portfolio/today     → today’s daily
 *  /api/portfolio/summary   → header stats
 */
const express  = require("express");
const router   = express.Router();
const prisma   = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");

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
router.use(requireAuth);


function safeJson(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? Number(v) : v
  ));
}

/* ============= HISTORY (monthly + daily) ============= */
router.get("/history", async (req, res) => {
  const uid = req.user.id;

  const [monthly, daily] = await Promise.all([
    prisma.netWorthSnapshot.findMany({
      where: { userId: uid },
      orderBy: { ts: "asc" }
    }),
    prisma.netWorthHistory.findMany({
      where: { userId: uid },
      orderBy: { ts: "asc" }
    })
  ]);

res.json(safeJson([...monthly, ...daily]));
});

/* ============= TODAY ============= */
router.get("/today", async (req, res) => {
  const uid      = req.user.id;
  const todayISO = new Date().toISOString().slice(0, 10);

  const point = await prisma.netWorthHistory.findFirst({
    where  : { userId: uid, date: todayISO },
    orderBy: { ts: "desc" }
  });

res.json(safeJson(point));
});

/* ============= SUMMARY ============= */
router.get("/summary", async (req, res) => {
  const uid = req.user.id;

  const [lastDaily, lastMonthly] = await Promise.all([
    prisma.netWorthHistory.findFirst({
      where: { userId: uid },
      orderBy: { ts: "desc" }
    }),
    prisma.netWorthSnapshot.findFirst({
      where: { userId: uid },
      orderBy: { ts: "desc" }
    })
  ]);

  if (!lastDaily) {
    return res.json({
      netWorth: 0, changeUSD: 0, changePct: 0,
      openPositions: 0, lastDaily: null, lastMonthly
    });
  }

  const base       = lastMonthly?.netWorth ?? lastDaily.value;
  const now        = lastDaily.value;
  const changeUSD  = +(now - base).toFixed(2);
  const changePct  = base ? +(((changeUSD / base) * 100).toFixed(2)) : 0;

res.json(safeJson({
  netWorth: now,
  changeUSD, changePct,
  openPositions: lastMonthly?.openPositions ?? 0,
  lastDaily, lastMonthly
}));
});

module.exports = router;