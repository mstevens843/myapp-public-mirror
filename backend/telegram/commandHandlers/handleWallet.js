// handleWallet.js - Telegram handler for /wallet command
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getFullNetWorth } = require("../../utils/getFullNetworth");

module.exports = async function handleWallet(bot, msg) {
  const chatId = msg.chat.id;
  const wallet = getCurrentWallet();
  const { totalValueUSD, tokenValues } = await getFullNetWorth(wallet.publicKey);

  const solToken = tokenValues.find(
    (t) => t.name === "SOL" || t.mint === "So11111111111111111111111111111111111111112"
  );
  const solBalance = solToken?.amount ?? 0;
  const solValue = solToken?.valueUSD ?? 0;

  const usdcToken = tokenValues.find(
    (t) => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );
  const usdcBalance = usdcToken?.amount ?? 0;
  const usdcValue = usdcToken?.valueUSD ?? 0;

  const response = [
    `👛 *Wallet Overview*`,
    `• SOL: ${solBalance.toFixed(3)} SOL ($${solValue.toFixed(2)})`,
    `• USDC: ${usdcBalance.toFixed(2)} USDC ($${usdcValue.toFixed(2)})`,
    `Net Worth: $${totalValueUSD.toFixed(2)}`,
    ``,
    `💱 *Convert Tokens:*`,
    `Use the buttons below to convert between SOL and USDC.`
  ].join("\n");
  
  await bot.sendMessage(chatId, response, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔁 SOL → USDC", callback_data: "convert:solToUsdc" },
          { text: "🔁 USDC → SOL", callback_data: "convert:usdcToSol" }
        ],
        [{ text: "🔙 Back to Menu", callback_data: "home" }]
      ]
    }
  });
  const breakdown = tokenValues
  .filter((t) =>
    t.name !== "SOL" &&
    t.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" &&
    t.valueUSD > 0
  )
  .sort((a, b) => b.valueUSD - a.valueUSD)
  .map((t) => `• ${t.name || "Unknown"}: $${t.valueUSD.toFixed(2)} (${t.amount.toFixed(2)})`)
  .join("\n");
  
  // 📦 Optional breakdown after
  if (breakdown) {
    await bot.sendMessage(chatId, `📦 *Token Breakdown:*\n${breakdown}`, {
      parse_mode: "Markdown"
    });
  }
}  