const { getUserDcaOrders, removeUserDcaOrder } = require("../services/dcaManager");

module.exports = async function handleCancelDca(bot, msg) {
  const chatId = msg.chat.id;
  const orders = await getUserDcaOrders(chatId);

  if (!orders || orders.length === 0) {
    return bot.sendMessage(chatId, "❌ No active DCA orders.");
  }

  const buttons = orders.map((o, i) => {
    const ts = new Date(o.createdAt || Date.now()).toLocaleString("en-US", {
      month: "2-digit", day: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    const unit = o.baseMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : "SOL";

    return [{
      text: `${o.tokenMint.slice(0, 6)}... – ${o.amountPerBuy.toFixed(2)} ${unit} x${o.totalBuys} (${ts})`,
      callback_data: `dca:delete:${i}`
    }];
  });

  buttons.push([{ text: "🔙 Back to Menu", callback_data: "home" }]);

  await bot.sendMessage(chatId, `🗑 *Select a DCA order to remove:*\nTotal: ${orders.length}`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons }
  });
};
