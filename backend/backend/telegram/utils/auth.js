const allowedChatIds = [
  6986790342, // your Telegram user ID
  // Add more if needed
];

function isAuthorized(chatId) {
  const authorized = allowedChatIds.includes(chatId);
  if (!authorized) console.warn(`⛔ Unauthorized access attempt from ${chatId}`);
  return authorized;
}

module.exports = { isAuthorized };