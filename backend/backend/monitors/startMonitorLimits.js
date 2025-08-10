// backend/monitors/startMonitorLimits.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { monitorLimitWeb } = require("../services/strategies/MonitorLimit.web");

(async () => {
  console.log("🚀 Starting Limit Order Web Monitor as standalone worker...");
  monitorLimitWeb();
})();