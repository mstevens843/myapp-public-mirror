// backend/monitors/startSubscriptionMonitor.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { subscriptionMonitor } = require("../cronjobs/subscriptionMonitor");

(async () => {
  console.log("🧾 Starting Subscription Monitor Cronjob...");

  // Run every 24h
  setInterval(async () => {
    console.log("📆 Running daily subscription check...");
    try {
      await subscriptionMonitor();
    } catch (err) {
      console.error("❌ Subscription monitor failed:", err.message);
    }
  }, 1000 * 60 * 60 * 24); // once per day
})();
