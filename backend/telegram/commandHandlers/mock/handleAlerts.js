// handleAlerts.js
module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
  
    // 🧪 Mock alert status
    const alertsEnabled = true;
    const alertTarget = "@matt"; // could be chat name or ID
    const alertTypes = ["Buy", "Sell", "Safety Fail", "TP Hit"];
  
    const message = `
  📢 *Telegram Alerts*
  
  • Status: ${alertsEnabled ? "✅ Enabled" : "❌ Disabled"}
  • Destination: ${alertTarget}
  • Types: ${alertTypes.join(", ")}
  
  _Use buttons below to manage alerts._
  `;
  
    const buttons = [
      [{ text: alertsEnabled ? "❌ Disable Alerts" : "✅ Enable Alerts", callback_data: "toggle:alertsEnabled" }],
      [{ text: "Change Destination", callback_data: "setAlertTarget" }],
      [{ text: "Manage Types", callback_data: "manageAlertTypes" }],
      [{ text: "🔙 Back to Menu", callback_data: "menu" }],
    ];
  
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  };
  