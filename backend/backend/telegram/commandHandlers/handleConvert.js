// handleConvert.js - Handles Telegram-triggered SOL <-> USDC swaps
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const axios = require("axios");
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { logTrade } = require("../../services/utils/analytics/logTrade");
const { sendBotAlert } = require("../botAlerts");


const API_BASE = process.env.API_BASE || "http://localhost:5001";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

module.exports = async function handleConvert(bot, msg, direction) {
  const chatId = msg.chat.id;

  const fromMint = direction === "solToUsdc" ? SOL_MINT : USDC_MINT;
  const toMint = direction === "solToUsdc" ? USDC_MINT : SOL_MINT;
  const label = direction === "solToUsdc" ? "SOL → USDC" : "USDC → SOL";

  await bot.sendMessage(chatId, `🔁 *${label}*\n\nHow much to convert? (e.g., \`0.5\`)`, {
    parse_mode: "Markdown",
  });

  const listener = async (msg2) => {
    bot.removeListener("message", listener);
    if (msg2.chat.id !== chatId) return;

    const amount = parseFloat(msg2.text.trim());

    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, "❌ Invalid amount. Please try again.");
    }

    try {
      const endpoint =
        direction === "solToUsdc" ? "/api/manual/buy" : "/api/manual/sell";

      const payload =
        direction === "solToUsdc"
          ? {
              mint: toMint,
              amountInSOL: amount,
              walletLabel: "default",
              slippage: 0.5,
              force: true,
            }
          : {
              mint: fromMint,
              amount: amount,
              walletLabel: "default",
              slippage: 0.5,
            };

      const res = await axios.post(`${API_BASE}${endpoint}`, payload);

      const {
        tx,
        inAmount,
        outAmount,
        entryPrice,
        exitPrice,
        priceImpact,
      } = res.data.result;

      if (!tx) throw new Error("No transaction was returned.");

      const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;

      await bot.sendMessage(chatId, `✅ *Swap Successful!*\n[View Transaction](${explorer})`, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
        },
      });

      await sendBotAlert(
        chatId,
        `🔁 *Swap Successful!*\n\n` +
        `• Direction: \`${label}\`\n` +
        `• Amount In: ${(inAmount / 1e9).toFixed(4)} ${fromMint === SOL_MINT ? "SOL" : "USDC"}\n` +
        `• Output: ${(outAmount / 1e6).toFixed(4)} ${toMint === SOL_MINT ? "SOL" : "USDC"}\n` +
        `• Price Impact: *${(priceImpact * 100).toFixed(2)}%*\n` +
        `• Tx: [View on Solana](${explorer})`,
        "Buy"
      );

      // 🧠 Log trade
      logTrade({
        strategy: "manual",
        inputMint: fromMint,
        outputMint: toMint,
        inAmount,
        outAmount,
        entryPrice,
        exitPrice,
        priceImpact,
        txHash: tx,
        success: true,
      });

    } catch (err) {
      console.error("❌ Swap error:", err?.response?.data || err.message);
      await sendBotAlert(
        chatId,
        `❌ Swap failed (${label}) — \`${err?.response?.data?.error || err.message}\``,
        "Buy"
      );
      return bot.sendMessage(chatId, `❌ Swap failed: ${err?.response?.data?.error || err.message}`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
        },
      });
    }
  };

  bot.on("message", listener);
};
