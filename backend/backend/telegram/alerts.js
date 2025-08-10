/* ------------------------------------------------------------------
 * Telegram Alerts – v3  (DB‑aware, universal)
 * -----------------------------------------------------------------*/
const axios  = require("axios");
const prisma = require("../prisma/prisma");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/* DB helper ------------------------------------------------------- */
async function getPrefs(userId) {
  const rec = await prisma.telegramPreference.findUnique({ where: { userId } });
  return rec
    ? rec
    : { chatId: null, enabled: false, types: [] };       // not connected
}

/* -----------------------------------------------------------------
 * sendAlert(userId, markdownMessage, type = "Buy")
 * type ∈  ["Buy","Sell","DCA","Limit","TP","SL", ...strategies, "Safety"]
 * ---------------------------------------------------------------- */
async function sendAlert(userId, message, type = "Buy") {
  const prefs = await getPrefs(userId);

  if (!prefs.enabled || !prefs.types.includes(type)) {
    console.log(`⚠️  Skip alert [${type}] for ${userId} — disabled or muted`);
    return;
  }
  if (!prefs.chatId) {
    console.log(`⚠️  No chatId on record for ${userId} – connect Telegram first`);
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id   : prefs.chatId,
      text      : message,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

module.exports = { sendAlert, getPrefs };
