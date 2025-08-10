module.exports = async (bot, msg, token = "BONK") => {
  const chatId = msg.chat.id;

  const message = `
👀 *Watchlist Updated (Mock)*

• Token: ${token}
• Safety: ✅ Pass
• Added: ${new Date().toLocaleString()}

Manage this list in settings or with /watchlist command.
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};
