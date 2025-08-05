// handleTpSlEditSelect.js – Show list of TP/SL tokens for single-select edit
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { loadSettings } = require("../utils/tpSlStorage");

module.exports = async function handleTpSlEdit(bot, msg) {
  const chatId = msg.chat.id;
  const userSettings = loadSettings()[chatId] || {};

  const tokens = Object.keys(userSettings);
  if (!tokens.length) {
    return bot.sendMessage(chatId, "❌ You don’t have any TP/SL tokens saved.");
  }

  const wallet = getCurrentWallet();
  const accounts = await getTokenAccountsAndInfo(wallet.publicKey);

  const inline_keyboard = tokens.map((mint) => {
    const token = accounts.find((t) => t.mint === mint);
    const name = token?.name && token.name !== "Unknown"
      ? token.name
      : mint.slice(0, 4) + "..." + mint.slice(-4);

    return [
      {
        text: `${name}`,
        callback_data: `tpSl:edit:${mint}`,
      },
    ];
  });

  inline_keyboard.push([{ text: "🔙 Back", callback_data: "tpsl" }]);

  const message = `
✏️ *Edit TP/SL Settings*

Select the token you want to update.
`.trim();

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard },
  });
};
