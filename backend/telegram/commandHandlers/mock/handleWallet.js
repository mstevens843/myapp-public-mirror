// handleWallet.js
// const { getWalletBalance } = require("../../controllers/manualTrader");

// // module.exports = async (bot, msg) => {
// //   const chatId = msg.chat.id;

// //   try {
// //     const balances = await getWalletBalance();
// //     let reply = "📊 *Wallet Balances:*\n";
// //     for (const [token, amt] of Object.entries(balances)) {
// //       reply += `• ${token}: ${amt}\n`;
// //     }
// //     bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
// //   } catch (err) {
// //     bot.sendMessage(chatId, `❌ Failed to fetch wallet balances: ${err.message}`);
// //   }
// // };



// // handleWallet.js
// module.exports = async (bot, msg) => {
//     const chatId = msg.chat.id;
  
//     // 🧾 Mocked wallet data (replace with real later)
//     const balanceSOL = 4.218;
//     const usdValue = 527.42;
  
//     const tokens = [
//       { name: "USDC", amount: 98.1, valueUSD: 98.1 },
//       { name: "BONK", amount: 1_000_000, valueUSD: 15.2 },
//       { name: "SLERF", amount: 120, valueUSD: 38.7 },
//       { name: "PIZZA", amount: 22_800, valueUSD: 5.14 },
//       { name: "FREN", amount: 31_900, valueUSD: 12.5 },
//     ];
  
//     // 🪪 Format message
//     let msgText = `*💰 Wallet Overview*\n\n`;
//     msgText += `*SOL Balance:* ${balanceSOL} SOL\n`;
//     msgText += `*Estimated Net Worth:* $${usdValue.toFixed(2)}\n\n`;
//     msgText += `*Top Holdings:*\n`;
  
//     for (const token of tokens) {
//       msgText += `• ${token.name}: ${token.amount.toLocaleString()} ($${token.valueUSD.toFixed(2)})\n`;
//     }
  
//     msgText += `\n_Only top tokens shown._`;
  
//     // 🔘 Inline actions
//     const buttons = [
//       [{ text: "Buy", callback_data: "buy" }, { text: "Sell", callback_data: "sell" }],
//       [{ text: "Refresh", callback_data: "wallet" }, { text: "Positions", callback_data: "positions" }],
//       [{ text: "Settings", callback_data: "settings" }]
//     ];
  
//     await bot.sendMessage(chatId, msgText, {
//       parse_mode: "Markdown",
//       reply_markup: {
//         inline_keyboard: buttons
//       }
//     });
//   };



// handleWallet.js - Telegram handler for /wallet command
module.exports = async (bot, msg) => {
  const chatId = msg.chat.id;

  const balances = [
    { token: "SOL", amount: "12.34" },
    { token: "BONK", amount: "690420" },
    { token: "JUP", amount: "1500" },
  ];

  const message = `👛 *Mock Wallet Balances*\n\n` + balances.map(b => `• ${b.token}: ${b.amount}`).join("\n");

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};
