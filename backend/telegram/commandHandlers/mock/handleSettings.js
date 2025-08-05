// handleSettings.js
module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
  
    // 🧪 Mock user preferences
    const preferences = {
      tpSlEnabled: true,
      degenMode: false,
      confirmBeforeTrade: false,
      alertsEnabled: true,
    };
  
    const status = (val) => (val ? "✅ On" : "❌ Off");
  
    const message = `
  ⚙️ *Bot Settings*
  
  • Take Profit / Stop Loss: ${status(preferences.tpSlEnabled)}
  • Degen Mode: ${status(preferences.degenMode)}
  • Confirm Before Trading: ${status(preferences.confirmBeforeTrade)}
  • Telegram Alerts: ${status(preferences.alertsEnabled)}
  
  _Tap a setting below to toggle it._
  `;
  
    const buttons = [
      [{ text: `TP/SL: ${status(preferences.tpSlEnabled)}`, callback_data: "toggle:tpSlEnabled" }],
      [{ text: `Degen Mode: ${status(preferences.degenMode)}`, callback_data: "toggle:degenMode" }],
      [{ text: `Confirm Before Trade: ${status(preferences.confirmBeforeTrade)}`, callback_data: "toggle:confirmBeforeTrade" }],
      [{ text: `Alerts: ${status(preferences.alertsEnabled)}`, callback_data: "toggle:alertsEnabled" }],
      [{ text: "🔙 Back to Menu", callback_data: "menu" }],
    ];
  
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  };
  