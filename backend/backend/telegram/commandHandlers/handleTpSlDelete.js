// handleTpSlDelete.js – TP/SL multi-delete menu with full internal logic
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { loadSettings, saveSettings } = require("../utils/tpSlStorage");
const sessions = require("../utils/sessions");

async function renderDeleteMenu(bot, chatId, msgId = null) {
  const userSettings = loadSettings()[chatId] || {};
  const tokens = Object.keys(userSettings);
  if (!tokens.length) {
    return bot.sendMessage(chatId, "❌ You don’t have any TP/SL tokens saved.");
  }

  const wallet = getCurrentWallet();
  const accounts = await getTokenAccountsAndInfo(wallet.publicKey);

  const tokenNameMap = {};
  for (const mint of tokens) {
    const found = accounts.find((a) => a.mint === mint);
    tokenNameMap[mint] = found?.name && found.name !== "Unknown"
      ? found.name
      : mint.slice(0, 4) + "..." + mint.slice(-4);
  }

  sessions[chatId] = sessions[chatId] || {};
  const selected = sessions[chatId].selectedToDelete || []; // ✅ start empty
  sessions[chatId].step = "awaitingTpSlDeleteMulti";
  sessions[chatId].selectedToDelete = selected;

  const buttons = tokens.map((mint) => {
    const selectedNow = selected.includes(mint);
    return [{
      text: `${selectedNow ? "☑️" : "⬜️"} ${tokenNameMap[mint]}`,
      callback_data: `toggleDelete:${mint}`,
    }];
  });

  buttons.push([
    { text: "❌ Cancel", callback_data: "cancelDeleteTpSl" },
    { text: "🗑️ Confirm Delete", callback_data: "confirmDeleteSelected" },
  ]);
  
  buttons.push([{ text: "🧹 Clear All", callback_data: "clearAllTpSl" }]);


  const payload = {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  };

  if (msgId) {
    return bot.editMessageReplyMarkup(payload.reply_markup, { chat_id: chatId, message_id: msgId });
  } else {
    return bot.sendMessage(chatId, "🗑️ *Delete TP/SL Settings*\n\n⬜️ Tap to select tokens\n🧹 Clear All or Confirm below", payload);
  }
}

module.exports = async function handleTpSlDelete(bot, msgOrQuery) {
    const chatId = msgOrQuery.message?.chat?.id || msgOrQuery.chat?.id;
    const data = msgOrQuery.data;

  if (!data || data === "tpSl:deleteMenu") {
    return renderDeleteMenu(bot, chatId);
  }

  const session = sessions[chatId] || {};
  const selected = session.selectedToDelete || [];

  // Toggle selection
  if (data.startsWith("toggleDelete:")) {
    const mint = data.split(":")[1];
    const i = selected.indexOf(mint);
    if (i >= 0) selected.splice(i, 1);
    else selected.push(mint);
    sessions[chatId].selectedToDelete = selected;
    return renderDeleteMenu(bot, chatId, msgOrQuery.message.message_id);
  }

  // Confirm delete
  if (data === "confirmDeleteSelected") {
    const all = loadSettings();
    const userConfig = all[chatId] || {};
    for (const mint of selected) delete userConfig[mint];
    if (Object.keys(userConfig).length === 0) delete all[chatId];
    else all[chatId] = userConfig;
    saveSettings(all);
    sessions[chatId].selectedToDelete = [];

    const wallet = getCurrentWallet();
    const accounts = await getTokenAccountsAndInfo(wallet.publicKey);
    
    const tokenNameMap = {};
    for (const mint of selected) {
      const found = accounts.find(a => a.mint === mint);
      tokenNameMap[mint] = found?.name && found.name !== "Unknown"
        ? found.name
        : mint.slice(0, 4) + "..." + mint.slice(-4);
    }
    
    const names = selected.map(mint => `• *${tokenNameMap[mint]}*\n\`${mint}\``).join("\n");
        return bot.sendMessage(chatId, `🗑️ Deleted *${selected.length}* TP/SL token(s):\n\n${names}`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to TP/SL", callback_data: "tpsl" }]],
      },
    });
}

  // Cancel delete
  if (data === "cancelDeleteTpSl") {
    sessions[chatId].selectedToDelete = [];
    return require("./handleTpSl")(bot, { chat: { id: chatId } });
  }

  if (data === "clearAllTpSl") {
    const all = loadSettings();
    delete all[chatId];
    saveSettings(all);
    sessions[chatId].selectedToDelete = [];
  
    return bot.sendMessage(chatId, "🧹 Cleared all TP/SL settings.", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to TP/SL", callback_data: "tpsl" }]],
      },
    });
  }
};
