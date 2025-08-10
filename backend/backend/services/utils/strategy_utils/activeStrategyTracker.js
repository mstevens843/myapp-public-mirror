// backend/services/utils/strategy_utils/activeStrategyTracker.js

const runningProcesses   = {};  // botId → { proc, mode, configPath, autoRestart }
const lastConfigPaths    = {};  // botId → config path string
const lastTickTimestamps = {};  // botId → ms   (keep)

/* ───────────────────────── Bootstrap ───────────────────────── */
const path = require("path");
const fs   = require("fs");
const { registerStrategyStatus } = require("./strategyStatus");

const runtimeDir = path.join(__dirname, "../runtime");

try {
  fs.readdirSync(runtimeDir)
    .filter(f => f.endsWith(".json"))
    .forEach(file => {
      const cfgPath = path.join(runtimeDir, file);
      const cfg     = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const botId   = cfg.botId;
      const mode    = cfg.mode || cfg.type || file.split("-")[0];

      lastConfigPaths[botId] = cfgPath;
      registerStrategyStatus(botId, mode, cfgPath);
    });
} catch {}

module.exports = {
  runningProcesses,
  lastConfigPaths,
  lastTickTimestamps,
};
