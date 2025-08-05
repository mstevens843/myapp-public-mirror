// handleWatchlist.js - Telegram handler for /watchlist command and mint additions
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const watchlist = require("../utils/watchlistData");

module.exports = async function handleWatchlist(bot, msg, mintArg = null) {
  const chatId = msg.chat.id;

  // If a mint is provided, add it to the watchlist
  if (mintArg) {
    watchlist.add(chatId, mintArg);
    return bot.sendMessage(chatId, `✅ Added \`${mintArg}\` to your watchlist.`, { parse_mode: "Markdown" });
  }

  // Show current watchlist
  const mints = watchlist.get(chatId);
  if (!mints.length) {
    return bot.sendMessage(chatId, "📭 Your watchlist is empty.");
  }

  for (const mint of mints) {
    const buttons = [
      [{ text: "🔄 Buy Again", callback_data: `buyAgain:${mint}` }]
    ];

    await bot.sendMessage(chatId, `🪙 Token: \`${mint}\``, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }
};
