let broadcast = () => {}; // placeholder, will be injected from index.js

function injectBroadcast(fn) {
  broadcast = fn;
}

// simple getter so other files can re-use the socket
function socketBroadcast(obj) {
  broadcast(JSON.stringify(obj));
}

// function socketBroadcast(payload) {
//   broadcast(payload);
// }

const allowed = ["sniper", "breakout", "chadMode", "delayedSniper", "dipBuyer",
  "paperTrader", "rebalancer", "rotationBot", "scalper", "trendFollower", "stealthbot", "scheduleLauncher", "scheduled",
]; // ✅ Add more like "scalper", "breakout" if needed
const allowedNormalized = allowed.map(s => s.toLowerCase());

// optional: filter specific log levels (you can toggle which)
const allowedLevels = ["info", "warn", "error", "loop", "summary", "debug"]; // ← adjust as needed

/**
/**
 * Create logger function for a given strategy + botId
 * Adds standard [INFO], [WARN], etc. tags and optionally includes DRY/LIVE
 */
const strategyLog = (strategy, botId = "main", config = {}) => {
  const isDryRun = config?.dryRun === true;
  const runTag = isDryRun ? "[🧪 DRY]" : "[🔫 LIVE]";
  const strategyLower = strategy.toLowerCase();

  return (type, message) => {
    const levelTag = {
      info: "[INFO]",
      warn: "[WARN]",
      error: "[ERROR]",
      loop: "[LOOP]",
      summary: "[SUMMARY]",  
      debug: "[DEBUG]",
    }[type.toLowerCase()] || "[INFO]";

    const full     = `${levelTag} ${runTag} [${strategy}] ${message}`;
    const payload  = { botId, level: levelTag.slice(1, -1), line: full };

    // ✅ Always log to terminal
    console.log(full);

    // ✅ Only broadcast if strategy + level are allowed
    if (
      allowedNormalized.includes(strategyLower) &&
      allowedLevels.includes(type.toLowerCase())
    ) {
      broadcast(JSON.stringify(payload));
    }
  };
};


module.exports = {
  strategyLog,
  injectBroadcast,
  socketBroadcast,
};



/**
 * . (Optional) Filter which levels are allowed to broadcast
If you want to only send "debug" logs when testing, you could add:

js
Copy
Edit
const shouldBroadcast = ["info", "warn", "error", "loop", "debug"].includes(type.toLowerCase());
if (shouldBroadcast && allowed.includes(strategy)) {
  broadcast(JSON.stringify(payload));
}

 */