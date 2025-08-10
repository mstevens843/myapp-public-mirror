// telegram/botAlerts.js
const axios = require("axios");
const { getTelegramPrefs } = require("./utils/telegramPrefs");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendBotAlert(userId, message, type = "Buy") {
  const prefs = getTelegramPrefs(userId);

  if (!prefs.enabled || !prefs.types.includes(type)) {
    console.log(`⚠️ Skipping alert [${type}] for ${userId} — alerts disabled or type not allowed.`);
    return;
  }

  const chatTarget = prefs.target || userId;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatTarget,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("❌ Failed to send Telegram bot alert:", err.message);
  }
}

module.exports = {
  sendBotAlert,
  sendAlert: sendBotAlert  // ✅ alias so manualExecutor etc can use neutral name
};
