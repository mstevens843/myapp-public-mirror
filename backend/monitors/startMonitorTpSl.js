// backend/monitors/startMonitorTpSl.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { monitorTpSlWeb } = require("../services/strategies/MonitorTpSl.web");

(async () => {
  console.log("🚀 Starting TP/SL Web Monitor as standalone worker...");
  monitorTpSlWeb(); // <- your existing loop is perfect
})();
