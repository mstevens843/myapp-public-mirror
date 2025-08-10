// handleSnipe.js – Telegram handler for /snipe <mint> (auto-buys if safe)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { performManualBuy } = require("../../services/manualExecutor");
const { rememberMint } = require("../utils/sessions");

module.exports = async function handleSnipe(bot, msg, mintArg = null) {
  const chatId = msg.chat.id;

  // ⛔ No input provided
  if (!mintArg) {
    return bot.sendMessage(chatId, "⚠️ Usage: `/snipe <mint>`", { parse_mode: "Markdown" });
  }

  try {
    // 🛡 Run safety check first
    const safe = await isSafeToBuy(mintArg);
    if (!safe) {
      return bot.sendMessage(chatId, "❌ Token failed safety check. Aborting.");
    }

    // 🛒 Auto-buy a preset amount (e.g. 0.25 SOL)
    const result = await performManualBuy(0.25, mintArg);
    const explorer = `https://explorer.solana.com/tx/${result.tx}?cluster=mainnet-beta`;

    // ✅ Add to recent mint history
    rememberMint(chatId, mintArg);

    await bot.sendMessage(chatId, `✅ *Sniped 0.25 SOL of*\n\`${mintArg}\`\n[View TX](${explorer})`, {
      parse_mode: "Markdown",
    });

  } catch (err) {
    console.error("❌ /snipe failed:", err.message);
    await bot.sendMessage(chatId, `❌ Snipe failed: ${err.message}`);
  }
};
