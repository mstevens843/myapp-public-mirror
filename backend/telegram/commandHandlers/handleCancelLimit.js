// telegram/commandHandlers/handleCancelLimit.js
const fs = require("fs");
const path = require("path");
const LIMITS_PATH = path.join(__dirname, "../../telegram/data/limit-orders.json");
const { getUserLimitOrders } = require("../utils/limitManager");

module.exports = async function handleCancelLimit(bot, msg) {
  const chatId = msg.chat.id;
  const orders = await getUserLimitOrders(chatId);

  if (orders.length === 0) {
    return bot.sendMessage(chatId, "❌ No active limit orders to cancel.");
  }

  const buttons = orders.map((o, i) => {
    const ts = new Date(o.createdAt).toLocaleString("en-US", {
      month: "2-digit", day: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    return [{
      text: `${o.side.toUpperCase()} ${o.token.slice(0, 6)}...${o.token.slice(-4)} – ${o.amount} USDC @ ${o.price} (${ts})`,
      callback_data: `limit:delete:${i}`
    }];
  });

  buttons.push([{ text: "🔙 Back to Menu", callback_data: "home" }]); // ✅ FIXED

  await bot.sendMessage(chatId, `🗑 *Select a limit order to remove:*\nTotal: ${orders.length}`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons }
  });
};
