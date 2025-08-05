// handleSettings.js - Telegram handler for /settings command (toggle user preferences)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getUserPreferences } = require("../services/userPrefs");

module.exports = async function handleSettings(bot, msg) {
  const chatId = msg.chat.id;

  // Fetch stored preferences from user config
  const preferences = await getUserPreferences(chatId);

  const status = (val) => (val ? "✅ On" : "❌ Off");

  const message = `
⚙️ *Bot Settings*

• Take Profit / Stop Loss: ${status(preferences.tpSlEnabled)}
• Degen Mode: ${status(preferences.degenMode)}
• Confirm Before Trading: ${status(preferences.confirmBeforeTrade)}
• Telegram Alerts: ${status(preferences.alertsEnabled)}
• Auto Buy: ${status(preferences.autoBuy?.enabled)}
• Slippage: *${preferences.slippage ?? 1.0}%*

_Tap a setting below to toggle it or update values._
`.trim();

  const buttons = [
    [{ text: `TP/SL: ${status(preferences.tpSlEnabled)}`, callback_data: "toggle:tpSlEnabled" }],
    [{ text: `Safe Mode: ${status(preferences.safeMode)}`, callback_data: "toggle:safeMode" }],
    [{ text: `Confirm Before Trade: ${status(preferences.confirmBeforeTrade)}`, callback_data: "toggle:confirmBeforeTrade" }],
    [{ text: `Alerts: ${status(preferences.alertsEnabled)}`, callback_data: "toggle:alertsEnabled" }],
    [{ text: `Auto Buy: ${status(preferences.autoBuy?.enabled)}`, callback_data: "toggle:autoBuyEnabled" }],
    [{ text: `✏️ Set Auto Buy Amount (${preferences.autoBuy?.amount ?? 0.05} SOL)`, callback_data: "edit:autoBuyAmount" }],
    [{ text: `✏️ Set Slippage (${preferences.slippage ?? 1.0}%)`, callback_data: "edit:slippage" }],
    [{ text: "🔙 Back to Menu", callback_data: "home" }],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
};
