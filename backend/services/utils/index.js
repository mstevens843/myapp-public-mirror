module.exports = {
  // analytics utils 
  ...require("./analytics/executionLogger"),
  ...require("./analytics/exportToCSV"),
  ...require("./analytics/logTrade"),
  ...require("./analytics/tradeSummary"),
  ...require("./analytics/openTrades"),


  // trade utils
  ...require("./trade/openTradesManager"),
  ...require("./trade/tradeUtils"),
  ...require("./trade/handleExitLogic"),



  // Safety & Risk
runSafetyChecks: require("./safety/safetyCheckers/fullSafetyEngine").runSafetyChecks,
  isSafeToBuy: require("./safety/safetyCheckers/botIsSafeToBuy").isSafeToBuy,
  isSafeToBuyDetailed: require("./safety/safetyCheckers/botIsSafeToBuy").isSafeToBuyDetailed,       // ✅ multi-source safety
  ...require("./safety/riskManager"),
  simulateAndCheckSwap: require("./safety/safetyCheckers/jupiterSimulationCheck").simulateAndCheckSwap, // ✅ ADD THIS LINE

  // Wallets
  // getWallet: require("./wallet/multiWalletExecutor").getWallet,
  ...require("./wallet/walletManager"),

  // Math & Utilities
  ...require("./math/mathUtils"),
  ...require("./math/timeUtils"),
  ...require("./math/priceUtils"),
  ...require("./math/scheduler"),
};

