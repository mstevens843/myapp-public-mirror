// 📁 telegram/autoRefresh.js
const handlePositions = require("../commandHandlers/handlePositions");

let autoRefreshUsers = new Set();

function startAutoRefresh(bot) {
  setInterval(async () => {
    for (const chatId of autoRefreshUsers) {
      try {
        await handlePositions(bot, { chat: { id: chatId } }, 0); // Always refresh page 0
      } catch (err) {
        console.error("Auto-refresh failed for", chatId, err);
      }
    }
  }, 60000); // every 60 seconds
}

function toggleAutoRefresh(chatId) {
  if (autoRefreshUsers.has(chatId)) {
    autoRefreshUsers.delete(chatId);
    return false;
  } else {
    autoRefreshUsers.add(chatId);
    return true;
  }
}

module.exports = { startAutoRefresh, toggleAutoRefresh };
