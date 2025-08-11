/* =========================================================
 *  Token Safety Routes
 * =========================================================
 *  • POST  /api/check-token-safety       – run full safety scan
 *  • GET   /api/safety/:mint             – market stats (free)
 *  • GET   /api/safety/target-token/:mint – market stats (paid→free fallback)
 * =========================================================*/

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const express  = require("express");
const router   = express.Router();

const { isSafeToBuyDetailedAPI } = require("../services/utils/safety/safetyCheckers/apiIsSafeToBuy");
const fetchTokenStatsFree        = require("../services/utils/safety/uiSafetyStatUtils/getTokenMarketStatsfree");
const fetchTokenStatsPaid        = require("../services/utils/safety/uiSafetyStatUtils/getTokenMarketStatsPaid");
const { sendAlert }    = require("../telegram/alerts");
const requireAuth = require("../middleware/requireAuth");
const { getUserPreferencesByUserId } = require("../services/userPrefs");
/* ───────────────────────── helpers ───────────────────────── */
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
function shortMint(m) { return `${m.slice(0, 4)}…${m.slice(-4)}`; }
function tsUTC() { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
// function isAppUser(uid) { return uid === "ui" || uid === "web"; }
// async function alertUser(uid, msg, tag) {
//   try {
//     if (isAppUser(uid)) await sendAlert(uid, msg, tag);
//     else                await sendBotAlert(uid, msg, tag);
//   } catch {/* swallow */}
// }

/* 🔥 Real alert dispatcher – NO botAlert bullshit */
/* 🔥 Unified alert dispatcher — identical to manual‑executor logic */
async function alertUser(userId, msg, tag = "Safety") {
  try {
    // pull prefs ‑ if user linked Telegram we’ll have a chatId
await sendAlert(userId, msg, tag);  
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}
/* =========================================================
 * POST /api/check-token-safety
 * =======================================================*/
router.post("/check-token-safety", requireAuth, async (req, res) => {
  const { mint, options = {} } = req.body;
  if (!mint) return res.status(400).json({ error: "Missing mint address." });

  try {
    /* Run full safety engine */
    const result   = await isSafeToBuyDetailedAPI(mint, options);
    const targetId = req.user.id;       // UI fallback

    /* Build checklist lines */
    const checks = Object.values(result)
      .filter(o => o && o.key && o.key !== "topHolderContract");

    const totalChecks  = checks.length;
    const passedChecks = checks.filter(c => c.passed).length;

    const checklist = checks
      .map(c => `• ${c.passed ? "✅" : "❌"} ${c.label || c.key}`)
      .join("\n");

    /* Build rich alert */
    const short     = shortMint(mint);
    const tokenUrl  = `https://birdeye.so/token/${mint}`;
    const time      = tsUTC();

    const alertMsg = `
🔍 *Safety Check Result*  (${passedChecks}/${totalChecks} passed)

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})

${checklist}

🕒 *Time:* ${time}
    `.trim();

    await alertUser(targetId, alertMsg, "Safety");
    res.json(result);

  } catch (err) {
    console.error("❌ Safety check error:", err);
    res.status(500).json({ error: err.message || "Failed to check token safety." });
  }
});
/* ================= Market‑stats (free) ================= */
router.get("/:mint", requireAuth, async (req, res) => {
  const { mint } = req.params;
  try {
    const data = await fetchTokenStatsFree(mint);
    if (!data) return res.status(500).json({ error: "Failed to fetch data" });
    res.json(data);
  } catch (err) {
    console.error("Token stats error:", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ========== Market‑stats (target token with paid→free) ========== */
router.get("/target-token/:mint", requireAuth, async (req, res) => {
  const { mint } = req.params;

  try {
    const paidData = await fetchTokenStatsPaid(mint);
    if (paidData) return res.json(paidData);
    throw new Error("Paid fetch returned null");
  } catch (err) {
    console.warn("❌ Paid token stats failed:", err.message);

    try {
      const fallback = await fetchTokenStatsFree(mint);
      if (fallback) return res.json(fallback);
      throw new Error("Free fallback also failed");
    } catch (fallbackErr) {
      console.error("❌ Token stats fallback failed:", fallbackErr.message);
      return res.status(500).json({ error: "Unable to fetch market stats." });
    }
  }
});

module.exports = router;