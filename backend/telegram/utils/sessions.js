// sessions.js
// 🔄 Tracks per-user Telegram state (token, amount, current step)
// Phase 2: Token Memory per User — we'll track and reuse recent mints across buy/sell/safety flows.


// sessions.js
const { loadMintMemory, saveMintMemory } = require("./mintStorage");

const sessions = {};

// 🧠 In-memory mint cache loaded from disk
const persistentMintMemory = loadMintMemory();

// 🔄 Remember mint (up to 3 per chat)
function rememberMint(chatId, mint) {
  if (!sessions[chatId]) sessions[chatId] = {};
  if (!sessions[chatId].recentMints) {
    sessions[chatId].recentMints = persistentMintMemory[chatId] || [];
  }

  // Move mint to front if already exists
  sessions[chatId].recentMints = [mint, ...sessions[chatId].recentMints.filter(m => m !== mint)];

  // Trim to last 3
  sessions[chatId].recentMints = sessions[chatId].recentMints.slice(0, 3);

  // Save to persistent memory
  persistentMintMemory[chatId] = sessions[chatId].recentMints;
  saveMintMemory(persistentMintMemory);
}

module.exports = {
  sessions,
  rememberMint
};