// backend/services/backgroundJobs.js
//
// Kicks off the three long-running monitors.
// Each monitor sets up its own setInterval √

const { monitorLimitWeb  } = require("./strategies/MonitorLimit.web"); 
const { monitorDcaWeb } = require("./strategies/MonitorDca.web");
const { monitorTpSlWeb } = require("./strategies/MonitorTpSl.web");
const { subscriptionMonitor } = require("../cronjobs/subscriptionMonitor");
const { monitorScheduler } = require("./utils/strategy_utils/scheduler/monitorScheduler");

/** Start all background workers (called once on server boot). */
function startBackgroundJobs() {
  monitorLimitWeb();   // ↻ every 15 s by default
  monitorDcaWeb();        // ✅ Use the correct DCA loop for web-based UI
  monitorTpSlWeb();        // ↻ every 60 s
  monitorScheduler();  // Scheduler watchdog – shows all armed jobs


  // run daily
  setInterval(() => {
    console.log(`📆 Running daily usage reset job…`);
    subscriptionMonitor().catch(console.error);
  }, 1000 * 60 * 60 * 24); // 24 hours

  console.log("🚀 Background jobs started (Limit, DCA, TP/SL, Scheduler, Daily Reset)");
}

module.exports = { startBackgroundJobs };