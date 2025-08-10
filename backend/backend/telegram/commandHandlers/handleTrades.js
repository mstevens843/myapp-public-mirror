// handleTrades.js - Telegram handler for /trades command (manual-trades.json only)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const fs = require("fs");
const path = require("path");
const { getTokenNameFromBirdeye } = require("../../utils/tokenMeta");


const TRADE_LOG_PATH = path.join(__dirname, "../../logs/manual-trades.json");

module.exports = async function handleTrades(bot, msg, page = 0) {
  const chatId = msg.chat.id;
  const PAGE_SIZE = 5;

  if (!fs.existsSync(TRADE_LOG_PATH)) {
    return bot.sendMessage(chatId, "📭 No manual trade log found.");
  }

  let allTrades = [];

  try {
    const raw = fs.readFileSync(TRADE_LOG_PATH, "utf-8");
    const content = JSON.parse(raw);
    if (Array.isArray(content)) {
      allTrades = content
        .filter(t =>
          t.success !== false &&
          (t.inputMint || t.mint) &&
          t.inAmount !== undefined &&
          t.outAmount !== undefined
        )
        .map(t => ({ ...t, strategy: "manual-trades" }));
    }
  } catch (err) {
    console.error("❌ Failed to read manual-trades.json:", err.message);
    return bot.sendMessage(chatId, "⚠️ Error reading manual trades log.");
  }

  allTrades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const total = allTrades.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const current = allTrades.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (current.length === 0) {
    return bot.sendMessage(chatId, "📭 No recent successful manual trades found.");
  }

  for (const trade of current) {
    const date = new Date(trade.timestamp).toLocaleString();
    const inAmount = Number(trade.inAmount || 0);
    const outAmount = Number(trade.outAmount || 0);
    const mint = trade.outputMint || trade.inputMint || trade.mint || "unknown";
    // const tokenName = trade.tokenName || "Unknown";
    let tokenName = trade.tokenName;
if (!tokenName || tokenName === "Unknown") {
  tokenName = await getTokenNameFromBirdeye(mint);
}

    const side = trade.side || trade.type || "unknown";
    const sideLine = side === "buy" ? "🛒 Buy" : side === "sell" ? "💰 Sell" : "❓ Unknown";

    let summaryLine = "";
    if (
      typeof trade.exitPrice === "number" &&
      typeof trade.inAmount === "number" &&
      typeof trade.outAmount === "number"
    ) {
      const grossSolOut = trade.exitPrice * (trade.outAmount / 1e6);
      const netSolIn = trade.inAmount / 1e9;
      const profitSol = grossSolOut - netSolIn;
      const emoji = profitSol >= 0 ? "🟢" : "🔴";
      const solStr = `${profitSol >= 0 ? "+" : ""}${profitSol.toFixed(4)} SOL`;
    
      let usdStr = "";
      if (typeof trade.usdValue === "number" && typeof trade.entryPrice === "number") {
        const estUsdIn = netSolIn * trade.entryPrice;
        const profitUsd = trade.usdValue - estUsdIn;
        usdStr = ` | ${profitUsd >= 0 ? "+" : ""}$${profitUsd.toFixed(2)}`;
      }
    
      const pnl = trade.gainLoss ? ` | ${Math.abs(parseFloat(trade.gainLoss)) >= 25 ? `*${trade.gainLoss}*` : trade.gainLoss}` : "";
      summaryLine = `${emoji} ${solStr}${usdStr}${pnl}`;
    }

// if (typeof trade.exitPrice === "number" && typeof trade.inAmount === "number" && typeof trade.outAmount === "number") {
//   const grossSolOut = trade.exitPrice * (trade.outAmount / 1e6);
//   const netSolIn = trade.inAmount / 1e9;
//   const profitSol = grossSolOut - netSolIn;
//   const prefix = profitSol >= 0 ? "🟢" : "🔴";
//   const formatted = profitSol.toFixed(4);
//   profitSolLine = `${prefix} Profit: ${formatted} SOL`;

//   if (typeof trade.usdValue === "number" && typeof trade.entryPrice === "number") {
//     const estUsdIn = netSolIn * trade.entryPrice;
//     const profitUsd = trade.usdValue - estUsdIn;
//     const prefixUsd = profitUsd >= 0 ? "🟢" : "🔴";
//     const formattedUsd = profitUsd.toFixed(2);
//     profitUsdLine = `${prefixUsd} Profit: $${formattedUsd}`;
//   }
// }



    const usdLine = trade.usdValue ? `💵 USD: $${trade.usdValue}` : "";
    const walletLine = trade.walletLabel ? `🏷️ Wallet: ${trade.walletLabel}` : "";
    const slippageLine = trade.slippage ? `🎯 Slippage: ${trade.slippage}%` : "";
    const notesLine = trade.notes ? `📝 ${trade.notes}` : "";

    const inputUi = (inAmount / 1e9).toFixed(3);
    const outputUi = (outAmount / 1e6).toFixed(3);

    const text = `
📊 *MANUAL-TRADES Trade Summary*

• ✅ Success
• ${sideLine}
• Token: \`${mint.slice(0, 6)}...${mint.slice(-4)}\` (${tokenName})
• Time: ${date}
• In: ${inputUi} SOL
• Out: ${outputUi} ${tokenName}
${summaryLine}
${usdLine}
${walletLine}
${slippageLine}
${notesLine}
    `.trim();

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  const navButtons = [];
  if (page > 0) navButtons.push({ text: "⬅️ Prev", callback_data: "trades:prev" });
  if ((page + 1) * PAGE_SIZE < total) navButtons.push({ text: "➡️ Next", callback_data: "trades:next" });

  if (navButtons.length) {
    await bot.sendMessage(chatId, "_Page navigation:_", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [navButtons] },
    });
  }
};
