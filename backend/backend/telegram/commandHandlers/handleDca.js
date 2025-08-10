// handleDca.js - Telegram handler for /dca command
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getUserDcaOrders } = require("../services/dcaManager");
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenBalance } = require("../../utils/marketData");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function formatTimestamp(ms) {
  const date = new Date(ms);
  const dateStr = date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} ${timeStr}`;
}

module.exports = async function handleDca(bot, msg) {
  const chatId = msg.chat.id;

  let dcaOrders = [];
  try {
    dcaOrders = await getUserDcaOrders(chatId);
  } catch (err) {
    console.error("❌ Failed to load DCA orders:", err.message);
    return bot.sendMessage(chatId, "❌ Failed to load your DCA orders.");
  }

  const wallet = getCurrentWallet();
  const solBalance = await getTokenBalance(wallet.publicKey, SOL_MINT);
  const usdcBalance = await getTokenBalance(wallet.publicKey, USDC_MINT);

  const totalCommitted = dcaOrders.reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0);
  const usesUsdc = dcaOrders.some(o => o.baseMint === USDC_MINT);
  const usesSol = dcaOrders.some(o => o.baseMint === SOL_MINT);

  let warning = "";
  if ((usesSol && totalCommitted > solBalance) || (usesUsdc && totalCommitted > usdcBalance)) {
    const balance = usesSol ? solBalance : usdcBalance;
    const unit = usesSol ? "SOL" : "USDC";
    const pct = ((totalCommitted / balance) * 100).toFixed(1);
    warning = `⚠️ You have ${totalCommitted.toFixed(2)} ${unit} in DCA orders, but only ${balance.toFixed(2)} ${unit} available.\n` +
              `You're committing *${pct}%* of your balance — some orders may fail.\n\n`;
  }

  const formatOrder = (o, i) => {
    const unit = o.baseMint === USDC_MINT ? "USDC" : "SOL";
    const created = formatTimestamp(o.createdAt || Date.now());
    return `${i + 1}. \`${o.tokenMint}\`\n• Every: ${o.frequency}h\n• Amount: ${o.amountPerBuy.toFixed(4)} ${unit} (${created})`;
  };

  const message = `
${warning}📉 *DCA Orders*

You currently have *${dcaOrders.length}* active order${dcaOrders.length === 1 ? "" : "s"}.

${dcaOrders.length ? dcaOrders.map(formatOrder).join("\n\n") : "_No active DCA orders found._"}

_Use the buttons below to manage your DCA strategy._
`.trim();

  const buttons = [
    [{ text: "➕ Add Order", callback_data: "dca:add" }],
    ...(dcaOrders.length > 0 ? [[{ text: "🗑 Remove Order", callback_data: "dca:remove" }]] : []),
    [{ text: "🔙 Back to Menu", callback_data: "home" }],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
};
