// handleRefer.js – Telegram handler for /refer command (share referral link + count)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
module.exports = async function handleRefer(bot, msg) {
  const chatId = msg.chat.id;

  const referralLink = "https://solpulse.net/invite/matt"; // 🔧 Replace with dynamic logic later
  const invites = 7; // 🔧 Replace with real invite count when backend ready

  const message = `
🎁 *Refer & Earn*

Share your link:
[Click to Copy](${referralLink})

Invites so far: *${invites}*

_Earn special perks by referring others._
`.trim();

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: false,
    reply_markup: {
      inline_keyboard: [
        [{ text: "📋 Copy Link", url: referralLink }],
        [{ text: "🔙 Back to Menu", callback_data: "home" }],
      ],
    },
  });
};


  // Good to keep as-is
// Clearly marked that link and count are mocked
// Solid Markdown formatting
// Clean inline buttons