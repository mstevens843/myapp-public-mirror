const sessions = require("../../utils/sessions");

module.exports = async (bot, msg, mintArg = null) => {
  const chatId = msg.chat.id;

  // 🧠 Use passed mint or fallback to most recent from session
  const recentMints = sessions[chatId]?.recentMints || [];
  const mint = mintArg || recentMints[0];

  if (!mint) {
    return bot.sendMessage(chatId, "❌ No recent token found. Use /sell or /positions first.");
  }

  const message = `
⚖️ *Manage Position*

Token: \`${mint}\`

Choose how much to sell:
  `;

  const buttons = [
    [
      { text: "Sell 25%", callback_data: `sellPercent:0.25:${mint}` },
      { text: "Sell 50%", callback_data: `sellPercent:0.5:${mint}` },
      { text: "Sell 100%", callback_data: `sellPercent:1:${mint}` },
    ],
    [{ text: "❌ Cancel", callback_data: "menu" }],
  ];

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  });
};
