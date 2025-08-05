// index.js inside /commandHandlers
const handleAlerts = require("./handleAlerts");
const handleBuy = require("./handleBuy");
const handleDca = require("./handleDca");
const handleLimits = require("./handleLimits");
const handleManage = require("./handleManage");
const handleMenu = require("./handleMenu");
const handlePositions = require("./handlePositions");
const handleRefer = require("./handleRefer");
const handleSafety = require("./handleSafety");
const handleSell = require("./handleSell");
const handleSettings = require("./handleSettings");
const handleSnipe = require("./handleSnipe");
const handleTrades = require("./handleTrades");
const handleWallet = require("./handleWallet");
const handleWatchlist = require("./handleWatchlist");
const TakeProfitStopLoss = require("./handleTpSl");
const handleCreateLimit = require("./handleCreateLimit");
const handleCancelLimit = require("./handleCancelLimit"); 
const handleUsdcSol = require("./handleConvert");
const handleCreateDca = require("./handleCreateDca");
const handleCancelDca = require("./handleCancelDca");
const handleTpSlDelete = require("./handleTpSlDelete"); 
const handleTpSlEdit = require("./handleTpSlEdit"); 


module.exports = {
  handleAlerts,
  handleBuy,
  handleDca,
  handleLimits,
  handleManage,
  handleMenu,
  handlePositions,
  handleRefer,
  handleSafety,
  handleSell,
  handleSettings,
  handleSnipe,
  handleTrades,
  handleWallet,
  handleWatchlist,
  TakeProfitStopLoss,
  handleCreateLimit, 
  handleCancelLimit,
  handleUsdcSol, 
  handleCreateDca,
  handleCancelDca,
  handleTpSlDelete,
  handleTpSlEdit,
};




/* 
// 🧪 Mock implementations for development/testing
// const handleAlerts = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Alerts");
// const handleBuy = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Buy");
// const handleDca = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: DCA Orders");
// const handleLimits = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Limit Orders");
// const handleManage = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Manage Tokens");
// const handleMenu = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Menu Options");
// const handlePositions = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Open Positions");
// const handleRefer = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Referral Page");
// const handleSafety = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Safety Check");
// const handleSell = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Sell");
// const handleSettings = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Settings Panel");
// const handleSnipe = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Snipe Function");
// const handleTrades = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Trade History");
// const handleWallet = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Wallet Info");
// const handleWatchlist = async (bot, msg) => bot.sendMessage(msg.chat.id, "🧪 Mock: Watchlist");
*/
