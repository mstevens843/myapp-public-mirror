// handleRefer.js
module.exports = async (bot, msg) => {
    const chatId = msg.chat.id;
  
    const referralLink = "https://solpulse.net/invite/matt"; // mock for now
    const invites = 7;
  
    const message = `
  🎁 *Refer & Earn*
  
  Share your link:
  [Click to Copy](${referralLink})
  
  Invites so far: *${invites}*
  
  _Earn special perks by referring others._
  `;
  
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      disable_web_page_preview: false,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Copy Link", url: referralLink }],
          [{ text: "🔙 Back to Menu", callback_data: "menu" }],
        ],
      },
    });
  };
  