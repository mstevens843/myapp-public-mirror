// handleTpSl.js – Telegram handler to list, show, and manage TP/SL settings
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const fs = require("fs");
const path = require("path");
const { getUserPreferences } = require("../services/userPrefs");
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { loadSettings } = require("../utils/tpSlStorage");

module.exports = async function handleTpSl(bot, msg) {
  const chatId = msg.chat.id;
  const userSettings = loadSettings()[chatId] || {}; // 🧠 match handlePositions.js
  const prefs = await getUserPreferences(chatId);
  const globalEnabled = prefs.tpSlEnabled;

  const wallet = getCurrentWallet();
  const accounts = await getTokenAccountsAndInfo(wallet.publicKey);

  const tokens = Object.keys(userSettings);

  const tokenNameMap = {};
  for (const mint of tokens) {
    const found = accounts.find(a => a.mint === mint);
    tokenNameMap[mint] = found?.name && found.name !== "Unknown"
      ? found.name
      : mint.slice(0, 4) + "..." + mint.slice(-4);
  }

  const globalNotice = globalEnabled
    ? ""
    : "⚠️ *TP/SL is currently disabled.*\nEnable it from Settings.\n\n";

  const display = tokens.length
    ? tokens.map((mint, i) => {
        const { tp, sl, enabled } = userSettings[mint];
        const name = tokenNameMap[mint];
        const statusSymbol = enabled === false ? "⛔" : "🎯";
        const tpText = tp !== undefined ? `${tp}%` : "–";
        const slText = sl !== undefined ? `${sl}%` : "–";
        return `${i + 1}. *${name}*\n\`${mint}\`\n${statusSymbol} TP: ${tpText} | SL: ${slText}`;
      }).join("\n\n")
    : "_No TP/SL settings configured._";

  const message = `
${globalNotice}🎯 *TP / SL Settings*

${display}

_Tap below to manage or update your settings._
`.trim();

  const inline_keyboard = [];

  inline_keyboard.push([{ text: "➕ Add New", callback_data: "tpSl:add" }]);

  if (tokens.length) {
    inline_keyboard.push([
      { text: "✏️ Edit Tp/Sl", callback_data: "tpSl:editMenu" },
      { text: "🗑️ Delete", callback_data: "tpSl:deleteMenu" },
      
    ]);
  }
  
  inline_keyboard.push([{ text: "🔙 Back", callback_data: "home" }]);

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard },
  });
};
