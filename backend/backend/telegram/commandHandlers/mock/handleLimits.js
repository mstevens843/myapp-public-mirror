// handleLimits.js
module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
  
    const message = `
  📊 *Limit Orders*
  
  Coming soon...
  
  Set buy/sell prices for tokens and let the bot execute when the market hits your levels.
  `;
  
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "menu" }]],
      },
    });
  };