// handleDca.js
module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
  
    const message = `
  📉 *DCA Orders*
  
  Coming soon...
  
  You'll be able to automate recurring buys on tokens using custom frequency and thresholds.
  `;
  
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "menu" }]],
      },
    });
  };
  