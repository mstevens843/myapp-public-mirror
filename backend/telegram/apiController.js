/* ------------------------------------------------------------------
 * Telegram API Controller
 * - Uses prisma-backed TelegramPreference
 * - Supports dynamic alert type toggles via types[]
 * -----------------------------------------------------------------*/

const { getPrefs, setPrefs } = require("./utils/telegramPrefs.db");
const { sendBotAlert } = require("./botAlerts");
const prisma = require("../prisma/prisma");

/* helper – pull auth’d userId off req.user */
const userIdFrom = (req) => req.user.id;

/* one source of truth: strategy type keys */
const STRATEGIES = [
  "Breakout",
  "Sniper",
  "Scalper",
  "ChadMode",
  "DipBuyer",
  "DelayedSniper",
  "TrendFollower",
  "RotationBot",
  "PaperTrader",
  "Rebalancer",
  "StealthBot",
  "Scheduled", 
];

/* -------------------- POST /api/telegram/set-chat-id -------------------- */
exports.setChatId = async (req, res) => {
  let { chatId } = req.body;
  if (chatId === undefined || chatId === null) {
    return res.status(400).json({ error: "chatId required" });
  }

  // normalize to string
  chatId = String(chatId).trim();
  if (!/^[1-9]\d{8,10}$/.test(chatId))
    return res.status(400).json({ error: "chatId invalid" });

  // write chatId, keep existing types
  await setPrefs(userIdFrom(req), {
    chatId,
    enabled: true,
  });

  res.json({ success: true });
};

/* -------------------- GET /api/telegram/chat-id -------------------- */
exports.getChatId = async (req, res) => {
  const { chatId } = await getPrefs(userIdFrom(req));
  res.json({ chatId });
};

/* -------------------- GET /api/telegram/preferences -------------------- */
exports.getPreferences = async (req, res) => {
  const prefs = await getPrefs(userIdFrom(req));
  const types = Array.isArray(prefs.types) ? prefs.types : [];

  res.json({
    trade: types.some((t) => ["Buy", "Sell"].includes(t)),
    orders: types.some((t) => ["DCA", "Limit"].includes(t)),
    tpSl: types.some((t) => ["TP", "SL"].includes(t)),
    autoBots: types.some((t) => STRATEGIES.includes(t)),
    scheduled: types.includes("ScheduledLaunch"),
    safety: types.includes("Safety"),
  });
};

/* -------------------- POST /api/telegram/preferences -------------------- */
exports.setPreferences = async (req, res) => {
  const { trade, orders, tpSl, autoBots, scheduled, safety } = req.body;

  const types = [];
  if (trade) types.push("Buy", "Sell");
  if (orders) types.push("DCA", "Limit");
  if (tpSl) types.push("TP", "SL");
  if (autoBots) types.push(...STRATEGIES);
  if (scheduled) types.push("ScheduledLaunch");
  if (safety) types.push("Safety");

  await setPrefs(userIdFrom(req), { types });
  res.json({ success: true });
};

/* -------------------- POST /api/telegram/clear -------------------- */
exports.clearChatId = async (req, res) => {
  const userId = userIdFrom(req);

  // set chatId NULL + disable
  await setPrefs(userId, { chatId: null, enabled: false });

  res.json({ success: true });
};

/* -------------------- POST /api/telegram/test -------------------- */
exports.sendTest = async (req, res) => {
  await sendBotAlert(userIdFrom(req), "✅ Telegram test successful!", "Buy");
  res.json({ sent: true });
};
