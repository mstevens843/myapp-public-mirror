// backend/monitors/startCronBundle.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { subscriptionMonitor } = require("../cronjobs/subscriptionMonitor");
const { startNetworthCron }   = require("../services/utils/analytics/netWorthSnapshot")

(async () => {
  console.log("📆 Cron Bundle Worker starting...");

  // Run subs once per day
  setInterval(async () => {
    console.log("🔄 Subscription monitor tick...");
    await subscriptionMonitor();
  }, 1000 * 60 * 60 * 24); // 24 hours

  // Run net worth on midnight schedule
  startNetworthCron(); // uses cron.schedule internally
})();