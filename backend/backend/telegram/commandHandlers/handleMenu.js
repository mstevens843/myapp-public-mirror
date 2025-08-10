// handleMenu.js - Telegram handler for /menu command (default = show positions page 0)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const handlePositions = require("./handlePositions");

module.exports = async function handleMenu(bot, msg) {
  return handlePositions(bot, msg, 0); // Page 0 = first page
};
