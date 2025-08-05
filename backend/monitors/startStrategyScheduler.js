require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { init } = require("../services/utils/strategy_utils/strategyScheduler");

(async () => {
  console.log("⏰ Strategy Scheduler booting up...");
  await init(); // this restores from ScheduledStrategy table
})();
