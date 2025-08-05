module.exports = async (bot, msg) => {
  const chatId = msg.chat.id;

  const message = `
📈 *Open Positions (Mock)*

1. BONK — 250k tokens
   • Entry: 0.00000312
   • TP: 0.00000420
   • SL: 0.00000269

2. JUP — 1,000 tokens
   • Entry: 0.97
   • TP: 1.2
   • SL: 0.88
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};