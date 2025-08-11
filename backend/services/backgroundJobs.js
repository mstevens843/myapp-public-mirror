// backend/services/backgroundJobs.js
//
// Kicks off the three long-running monitors.
// Each monitor sets up its own setInterval √

const { monitorLimitWeb  } = require("./strategies/MonitorLimit.web"); 
const { monitorDcaWeb } = require("./strategies/MonitorDca.web");
const { monitorTpSlWeb } = require("./strategies/MonitorTpSl.web");
const { subscriptionMonitor } = require("../cronjobs/subscriptionMonitor");
const { monitorScheduler } = require("./utils/strategy_utils/scheduler/monitorScheduler");
// Import stuck order watchdog; behind feature flag
const { startWatchdog: startStuckOrderWatchdog } = require('./watchdogs/stuckOrders');
const { isEnabled } = require('../utils/featureFlags');

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

  // Optionally start the stuck order watchdog. This is disabled by default and
  // can be enabled by setting FEATURE_STUCK_ORDERS_WATCHDOG=1 in the environment.
  if (isEnabled('STUCK_ORDERS_WATCHDOG')) {
    try {
      startStuckOrderWatchdog();
      console.log('🐶 Stuck order watchdog activated');
    } catch (err) {
      console.error('Failed to start stuck order watchdog:', err.message);
    }
  }
}

module.exports = { startBackgroundJobs };