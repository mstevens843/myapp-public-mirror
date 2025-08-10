// handleAlerts.js - Telegram handler for /alerts command
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getTelegramPrefs } = require("../utils/telegramPrefs");
const { sessions } = require("../utils/sessions");

module.exports = async function handleAlerts(bot, msg) {
  const chatId = msg.chat.id;

  // Retrieve session or fallback prefs
  const session = sessions[chatId] || {};
  const alertPrefs = session.alertPrefs || getTelegramPrefs(chatId) || {
    enabled: false,
    target: `@${msg.chat.username || chatId}`,
    types: ["Buy", "Sell"],
  };

  const { enabled, target, types } = alertPrefs;

  const message = `
📢 *Telegram Alerts*

• Status: ${enabled ? "✅ Enabled" : "❌ Disabled"}
• Destination: ${target}
• Types: ${types.join(", ")}

_Use buttons below to manage alerts._
`;

  const buttons = [
    [{ text: enabled ? "❌ Disable Alerts" : "✅ Enable Alerts", callback_data: "toggle:alertsEnabled" }],
    [{ text: "Change Destination", callback_data: "setAlertTarget" }],
    [{ text: "Manage Types", callback_data: "manageAlertTypes" }],
    [{ text: "🔙 Back to Settings", callback_data: "home" }],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
};
