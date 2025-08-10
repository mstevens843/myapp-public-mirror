module.exports = async (bot, msg, token = "BONK") => {
  const chatId = msg.chat.id;

  const message = `
🛡️ *Safety Check (Mock)* for *${token}*

• Verified: ✅
• Freeze Authority: ❌ Revoked
• Mint Authority: ✅ Owned
• Top Holder %: 12.3%
• Liquidity: ✅ $850K
• Honeypot Risk: ❌ None

_Simulation only. Always DYOR._
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};
