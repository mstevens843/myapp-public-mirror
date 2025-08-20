const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { runningProcesses, lastTickTimestamps } = require("./activeStrategyTracker");
const { socketBroadcast } = require("../../strategies/logging/strategyLogger"); 
const STRIP_ANSI = /\x1B\[[0-9;]*m/g; 

const MAX_IDLE_MS = 60_000; // 1 minute threshold
const watchdogLogs = {}; // botId → latest log string

function startWatchdog() {
  setInterval(() => {
    const now = Date.now();

    for (const [botId, info] of Object.entries(runningProcesses)) {
      const { proc, configPath, mode, finished } = info;

      if (finished) continue;       
      if (mode === "scheduled" || mode.startsWith("schedule")) continue;     

      const last = lastTickTimestamps[botId] ?? 0;
      const seconds = Math.floor((now - last) / 1000);

      if (now - last > MAX_IDLE_MS) {
        const log = `Restarted at ${new Date().toLocaleTimeString()} due to ${seconds}s idle`;
        console.warn(`🐶 [Watchdog] ${botId} ${log}`);
        watchdogLogs[botId] = log;

        try {
          proc.kill("SIGINT");
        } catch (err) {
          console.error(`❌ Failed to kill ${botId}:`, err.message);
        }

        // ✅ Inject restart flag to config so it skips startTime check
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          config.isRestart = true;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch (e) {
          console.error(`⚠️ Failed to inject isRestart flag: ${e.message}`);
        }

        const retry = spawn("node", [`services/strategies/${mode}.js`, configPath], {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: process.cwd(),
        });

        function forwardLines(chunk) {
          chunk
            .toString()
            .split(/\r?\n/)
            .filter(Boolean)
            .forEach((line) => {
              const clean = line.replace(STRIP_ANSI, "");
              let lvl = "INFO";
              const tag = clean.match(/^\[([A-Za-z]+)\]/);
              if (tag) {
                lvl = String(tag[1]).toUpperCase();
              } else if (/(error|exception|cannot find module|unhandled)/i.test(clean)) {
                lvl = "ERROR";
              } else if (/warn/i.test(clean)) {
                lvl = "WARN";
              }
              socketBroadcast({ botId, level: lvl, line: clean });
            });
        }

        retry.stdout.on("data", forwardLines);
        retry.stderr.on("data", forwardLines);

        runningProcesses[botId] = {
          proc: retry,
          mode,
          autoRestart: true,
          configPath,
        };
        lastTickTimestamps[botId] = Date.now();
      } else {
        const log = `Pulse OK: ticked ${seconds}s ago`;
        console.log(`🐶 [Watchdog] ${botId} ${log}`);
        watchdogLogs[botId] = log;
      }
    }
  }, 15_000);
}

function getWatchdogLog(botId) {
  return watchdogLogs[botId] || null;
}

module.exports = {
  startWatchdog,
  getWatchdogLog,
};
