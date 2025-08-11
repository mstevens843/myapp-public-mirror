const express = require("express");
const router = express.Router();

// ✅ Use new controller based on telegramPrefs + botAlerts
const alerts = require("../telegram/apiController");

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
// POST /api/telegram/set-chat-id
router.post("/set-chat-id", alerts.setChatId);

// GET /api/telegram/chat-id
router.get("/chat-id", alerts.getChatId);

// GET /api/telegram/preferences
router.get("/preferences", alerts.getPreferences);

// POST /api/telegram/preferences
router.post("/preferences", alerts.setPreferences);

// POST /api/telegram/test
router.post("/test", alerts.sendTest);

// POST /api/telegram/clear
router.post("/clear", alerts.clearChatId);

module.exports = router;