module.exports = async (bot, msg) => {
  const chatId = msg.chat.id;

  const trades = [
    { token: "BONK", type: "Buy", amount: "100 SOL", result: "+12%" },
    { token: "JUP", type: "Sell", amount: "50 SOL", result: "-4%" },
  ];

  const message = `
📊 *Trade History (Mock)*

${trades.map(t => `• ${t.type} ${t.token} — ${t.amount} — ${t.result}`).join("\n")}
  `;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
};
