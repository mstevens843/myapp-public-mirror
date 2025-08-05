// core/loopDriver.js
const { lastTickTimestamps } = require("../../utils/strategy_utils/activeStrategyTracker");

 function runStrategyLoop(tick, intervalMs, { label, botId = "manual" }) {
   let running = false;                 // 🔒 simple mutex

   async function wrapped() {
     if (running) return;               // another tick still working
     running = true;
     try {
       lastTickTimestamps[botId] = Date.now();
       await tick();
     } finally {
       running = false;
     }
   }

   wrapped();                           // fire once immediately
   if (intervalMs > 0) return setInterval(wrapped, intervalMs);
   return null;
 }

module.exports = runStrategyLoop;
