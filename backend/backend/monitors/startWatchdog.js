// backend/monitors/startWatchdog.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { startWatchdog } = require("../services/utils/strategy_utils/watchdog");

(async () => {
  console.log("🐶 Watchdog Monitor starting...");
  startWatchdog(); // runs setInterval loop
})();
