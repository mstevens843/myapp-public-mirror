module.exports = {
  // REAL HANDLERS (enabled)
    handleBuy: require("./handleBuy"),
    handleSell: require("./handleSell"),
    handleWallet: require("./handleWallet"),
    handlePositions: require("./handlePositions"),
    handleSafety: require("./handleSafety"),
    handleTrades: require("./handleTrades"),
    handleWatchlist: require("./handleWatchlist"),
    handleMenu: require("./handleMenu"),
    handleSettings: require("./handleSettings"),
  };


// MOCK HANDLERS (disabled)
// const handleBuy = require("./mock/handleBuy");
// const handleSell = require("./mock/handleSell");
// const handleWallet = require("./mock/handleWallet");
// const handlePositions = require("./mock/handlePositions");
// const handleSafety = require("./mock/handleSafety");
// const handleTrades = require("./mock/handleTrades");
// const handleWatchlist = require("./mock/handleWatchlist");