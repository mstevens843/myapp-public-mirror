// backend/monitors/startMonitorDca.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { monitorDcaWeb } = require("../services/strategies/MonitorDca.web")

(async () => {
  console.log("🚀 Starting DCA Web Monitor as standalone worker...");
  monitorDcaWeb();
})();
