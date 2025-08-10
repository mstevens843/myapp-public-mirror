module.exports = async (bot, msg, token, amount) => {
  const chatId = msg.chat.id;

  const message = `
🧪 *Mock Buy Order*

• Token: ${token}
• Amount: ${amount} SOL
• Price: 0.0023 SOL
• Slippage: 1%
• Wallet: default

_This is a simulation. No real trade was executed._
  `;

  const buttons = [
    [{ text: "✅ Confirm (Mock)", callback_data: "confirmMockBuy" }],
    [{ text: "🔙 Back to Menu", callback_data: "menu" }],
  ];

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
};
