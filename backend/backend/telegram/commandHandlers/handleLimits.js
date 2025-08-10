// handleLimits.js - Telegram handler for /limits command
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getUserLimitOrders } = require("../utils/limitManager");
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenBalance } = require("../../utils/marketData");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function formatTimestamp(ms) {
  const date = new Date(ms);
  const dateStr = date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} ${timeStr}`;
}

module.exports = async function handleLimits(bot, msg) {
  const chatId = msg.chat.id;

  let limitOrders = [];
  try {
    limitOrders = await getUserLimitOrders(chatId);
  } catch (err) {
    console.error("❌ Failed to fetch limit orders:", err.message);
    return bot.sendMessage(chatId, "❌ Failed to load limit orders.");
  }

  // Sort by price ascending
  limitOrders.sort((a, b) => a.price - b.price);

  const buyOrders = limitOrders.filter(o => o.side === "buy");
  const sellOrders = limitOrders.filter(o => o.side === "sell");

  // ✅ Overcommit warning
  const wallet = getCurrentWallet();
  const usdcBalance = await getTokenBalance(wallet.publicKey, USDC_MINT);

  const totalCommitted = buyOrders.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);

  let warning = "";
  if (totalCommitted > usdcBalance) {
    const pct = ((totalCommitted / usdcBalance) * 100).toFixed(1);
    warning = `⚠️ You have $${totalCommitted.toFixed(2)} in buy limits, but only $${usdcBalance.toFixed(2)} USDC available.\n` +
              `You're committing *${pct}%* of your balance — some orders may fail if triggered.\n\n`;
  }

  const formatSection = (title, orders) => {
    if (orders.length === 0) return `*${title}*\n_No orders._\n`;
    return `*${title}*\n` + orders
      .map((o, i) => {
        const ts = formatTimestamp(o.createdAt || Date.now());
        return `${i + 1}. \`${o.token}\` – ${o.amount} USDC @ $${o.price} (${ts})`;
      })
      .join("\n") + `\n`;
  };

  const message = `
${warning}📊 *Limit Orders*

Total: *${limitOrders.length}* active

${formatSection("🟢 Buy Orders", buyOrders)}
${formatSection("🔴 Sell Orders", sellOrders)}

_Manage your buy/sell targets below._
`.trim();

  const buttons = [
    [{ text: "➕ Add Order", callback_data: "limit:add" }],
    ...(limitOrders.length > 0 ? [[{ text: "🗑 Remove Order", callback_data: "limit:remove" }]] : []),
    [{ text: "🔙 Back to Menu", callback_data: "menu" }],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
};
