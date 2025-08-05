module.exports = async (bot, msg, mintArg = null) => {
  const chatId = msg.chat.id;

  if (!mintArg) {
    return bot.sendMessage(chatId, "⚠️ Usage: `/snipe <mint>`", { parse_mode: "Markdown" });
  }

  // 🧪 Simulated mock response
  const mockTxId = "5GJHghe7vhEXAMPLEFAKEeTxSxhsdgT3gxpGiY6d8Tx";
  const explorer = `https://explorer.solana.com/tx/${mockTxId}?cluster=mainnet-beta`;

  const message = `
🎯 *Mock Snipe Triggered!*

• Token: \`${mintArg}\`
• Amount: 0.25 SOL
• Safety: ✅ Passed
• TX: [View on Explorer](${explorer})

_Note: This is a mock. No actual transaction was sent._
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};