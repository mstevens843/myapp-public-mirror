// handleMenu.js
module.exports = async (bot, msg) => {
  const chatId = msg.chat.id;
  console.log("📥 /menu called from", chatId); // <-- TEMP DEBUG

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💸 Buy", callback_data: "buy" }, { text: "💰 Sell", callback_data: "sell" }],
        [{ text: "📈 Positions", callback_data: "positions" }, { text: "📊 Trade History", callback_data: "trades" }],
        [{ text: "📊 Wallet", callback_data: "wallet" }, { text: "🛡️ Safety", callback_data: "safety" }],
        [{ text: "⚙️ Settings", callback_data: "settings" }, { text: "🔔 Alerts", callback_data: "alerts" }],
        [{ text: "🎯 DCA Orders", callback_data: "dca" }, { text: "📐 Limit Orders", callback_data: "limits" }],
        [{ text: "🎁 Refer Friends", callback_data: "refer" }]
        // { text: "🔙 Menu", callback_data: "menu" }
      ],
    },
  };

  bot.sendMessage(chatId, "🤖 Choose an action:", opts);
};
