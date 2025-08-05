let openTrades = [];

function getOpenTrades() {
  return openTrades;
}

function addOpenTrade(trade) {
  openTrades.push(trade);
}

function clearOpenTrades() {
  openTrades = [];
}

function removeOpenTradeByMint(mint) {
  openTrades = openTrades.filter(t => t.token !== mint);
}

module.exports = {
  getOpenTrades,
  addOpenTrade,
  clearOpenTrades,
  removeOpenTradeByMint,
};



// Centralized source of truth for openTrades, outside of all strategies. 
// 100% consistency across all strategies. 
