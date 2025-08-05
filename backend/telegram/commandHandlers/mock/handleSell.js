module.exports = async (bot, msg, token, amount) => {
  const chatId = msg.chat.id;

  const message = `
🧪 *Mock Sell Order*

• Token: ${token}
• Amount: ${amount} SOL
• Expected Return: ~${amount * 0.0021} SOL
• Slippage: 1%

_This is a mock trade. No assets were sold._
  `;

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
  });
};


// ✅ Final Flow (Telegram UX):
// User clicks Sell & Manage

// Bot shows:

// less
// Copy
// Edit
// ⚖️ Manage Position
// Token: SLAP
// Choose how much to sell:
// [ Sell 25% ] [ Sell 50% ] [ Sell 100% ]
// [ Cancel ]
