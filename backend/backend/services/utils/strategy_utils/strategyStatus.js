const fs = require("fs");
const path = require("path");

// 🔑 Map keyed by botId → allows multiple bots of same mode
const strategyStatusMap = {}; // botId → { mode, configPath, startedAt, config, ... }

// Helper to format uptime (ms → "3m 05s")
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}m ${ss}s`;
}

// Register a new strategy’s status
function registerStrategyStatus(botId, mode, configPath) {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);

    strategyStatusMap[botId] = {
      botId,
      mode,
      configPath,
      config,
      startedAt: new Date().toISOString(), // optional ISO for logs

      startTime: Date.now(),     // uptime clock base
      pausedAt: null,            // timestamp when paused
      pauseAccum: 0,             // total ms paused

      restartCount: 0,
      tradesExecuted: 0,
      maxTrades: config.maxTrades ?? null,
    };
  } catch (err) {
    console.error(`❌ Failed to load strategy config for ${botId}:`, err.message);
  }
}

// Clear bot status on shutdown/deletea
function clearStrategyStatus(botId) {
  delete strategyStatusMap[botId];
}

// Get status for one bot
function getStrategyStatus(botId) {
  return strategyStatusMap[botId] || null;
}

// Get status for all bots, including computed uptime
function getAllStrategyStatuses() {
  const now = Date.now();

  for (const meta of Object.values(strategyStatusMap)) {
    const spent = meta.pausedAt
      ? meta.pausedAt - meta.startTime
      : now - meta.startTime - (meta.pauseAccum ?? 0);

    meta.uptimeRaw = spent;
    meta.uptime = formatUptime(spent);
  }

  return strategyStatusMap;
}

function markPaused(botId) {
  const meta = strategyStatusMap[botId];
  if (!meta || meta.pausedAt) return;           // already paused
  meta.pausedAt = Date.now();
}

function markResumed(botId) {
  const meta = strategyStatusMap[botId];
  if (!meta || meta.pausedAt == null) return;   // wasn’t paused
  meta.pauseAccum += Date.now() - meta.pausedAt;
  meta.pausedAt = null;
}

module.exports = {
  registerStrategyStatus,
  clearStrategyStatus,
  getStrategyStatus,
  getAllStrategyStatuses,
  markPaused,
  markResumed,
};
