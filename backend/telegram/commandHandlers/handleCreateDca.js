// handleCreateDca.js
const { addUserDcaOrder } = require("../services/dcaManager");
const { sendBotAlert } = require("../botAlerts");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

module.exports = async function handleCreateDca(bot, msg) {
  const chatId = msg.chat.id;
  bot.removeAllListeners("message");

  const prompt = `
📝 *Create DCA Order*

------------------------

📘 *Each Part Explained:*

\`TOKEN_MINT\` — e.g. \`7GCihgD...\`\n  → The token mint to buy (e.g. Popcat, Bonk, etc.)

\`AMOUNT+UNIT\` — e.g. \`1sol\` or \`25usdc\`\n  → Total to invest. Use SOL or USDC.

\`#_OF_BUYS\` — e.g. \`4\`\n  → Number of chunks to split into (e.g. 0.25 each)

\`FREQ_HOURS\` — e.g. \`1\`\n  → How often to buy (in hours)

\`STOP_IF_ABOVE\` — e.g. \`0.65\` *(optional)*\n  → Skip the buy if price is above this

\`STOP_IF_BELOW\` — e.g. \`0.45\` *(optional)*\n  → Skip the buy if price is below this

------------------------

Format:
\`[TOKEN_MINT] [AMOUNT+UNIT] [#_OF_BUYS] [FREQ_HOURS] [STOP_IF_ABOVE]? [STOP_IF_BELOW]?\`

Examples:
• \`7GCihg... 1sol 4 1\` → Buy 0.25 SOL every 1h
• \`7GCihg... 50usdc 5 2 0.65 0.45\` → Buy 10 USDC every 2h (only between $0.45–$0.65)
• \`7GCihg... 50usdc 5 2 - 0.45\` → Only buy if price is *below* $0.45
• \`7GCihg... 50usdc 5 2 0.65 -\` → Only buy if price is *below* $0.65
• \`7GCihg... 50usdc 5 2 0.65 0.45\` → Use both upper and lower limits (safe buy zone)

💡 _Paste everything on one line. I'll handle the rest!_
`.trim();

  await bot.sendMessage(chatId, prompt, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home" }]]
    }
  });

  const listener = async (msg2) => {
    if (msg2.chat.id !== chatId) return;

    bot.removeListener("message", listener);
    const text = msg2.text.trim();
    const parts = text.split(" ");

    if (parts.length < 4) {
      return bot.sendMessage(chatId, "❌ Invalid format. Try again.");
    }

    const [tokenMint, amountUnit, totalBuysStr, freqStr, stopAboveStr, stopBelowStr] = parts;

    const match = amountUnit.toLowerCase().match(/^([\d.]+)(sol|usdc)$/);
    if (!match) {
      await bot.sendMessage(chatId, "❌ Invalid amount format. Use like `1sol` or `10usdc`. Please try again.", { parse_mode: "Markdown" });
      return bot.on("message", listener); // 👈 reattach listener
    }

    const totalAmount = parseFloat(match[1]);
    const unit = match[2];
    const baseMint = unit === "sol" ? SOL_MINT : USDC_MINT;

    const totalBuys = parseInt(totalBuysStr);
    const frequency = parseFloat(freqStr);

    if (!tokenMint || isNaN(totalAmount) || isNaN(totalBuys) || isNaN(frequency)) {
      await bot.sendMessage(chatId, "❌ Invalid values. Please try again.");
      return bot.on("message", listener);
    }

    const stopAbove = stopAboveStr && stopAboveStr !== "-" ? parseFloat(stopAboveStr) : null;
    const stopBelow = stopBelowStr && stopBelowStr !== "-" ? parseFloat(stopBelowStr) : null;

    const order = {
        tokenMint,
        baseMint,
        totalAmount,
        totalBuys,
        amountPerBuy: totalAmount / totalBuys,
        frequency,
        completedBuys: 0,
        nextBuyTime: Date.now() + frequency * 60 * 60 * 1000,
        walletLabel: "default",
        slippage: 1.0,
        stopIfPriceAbove: stopAbove,
        stopIfPriceBelow: stopBelow,
        createdAt: Date.now()
      };

    addUserDcaOrder(chatId, order);

    await sendBotAlert(
        chatId,
        `📈 *New DCA Order Set!*\n\nToken: \`${tokenMint}\`\nChunks: *${totalBuys} x ${order.amountPerBuy.toFixed(4)} ${unit.toUpperCase()}*\nEvery: *${frequency}h*`,
        "DCA"
      );

    const baseUnit = unit.toUpperCase();
    await bot.sendMessage(chatId, `✅ *DCA Order Added!*\n\nToken: \`${tokenMint}\`\nAmount per buy: ${order.amountPerBuy.toFixed(4)} ${baseUnit}\nEvery: ${frequency}h\nChunks: ${totalBuys}`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });
  };

  bot.on("message", listener);
};
