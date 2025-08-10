// backend/monitors/startPortfolioUpdater.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { startNetworthCron } = require("../services/utils/analytics/netWorthSnapshot")

(async () => {
  console.log("💰 Starting Portfolio Net Worth Cron...");
  startNetworthCron(); // whatever you use internally, it should be a setInterval or cron.schedule
})();
