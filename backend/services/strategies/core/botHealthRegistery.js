// backend/services/health/botHealthRegistry.js
/**
 * In-memory health registry for running bot processes.
 * Thresholds via env (ms): HEALTH_WARN_STALE_MS, HEALTH_ALERT_STALE_MS, HEALTH_WARN_LOOP_MS
 */

const warnStaleMs = parseInt(process.env.HEALTH_WARN_STALE_MS || '90000', 10);
const alertStaleMs = parseInt(process.env.HEALTH_ALERT_STALE_MS || '180000', 10);
const warnLoopMs  = parseInt(process.env.HEALTH_WARN_LOOP_MS  || '3000', 10);

const registry = {}; // { [botId]: { ...fields..., confirmedLevel, degradeCount } }

const levelOrder = { green: 0, yellow: 1, red: 2 };

/**
 * Merge a partial payload into an existing bot health entry.
 * @param {string} botId
 * @param {object} partial
 */
function update(botId, partial = {}) {
  if (!botId) return;
  const existing = registry[botId] || { botId, restartCount: 0 };
  const next = {
    ...existing,
    ...partial,
    botId,
    restartCount:
      typeof partial.restartCount === 'number' && Number.isFinite(partial.restartCount)
        ? partial.restartCount
        : (existing.restartCount || 0),
  };
  registry[botId] = next;
}

/**
 * Return snapshot: { ts, bots: { [botId]: { ...fields, lastTickAgoMs, healthLevel } } }
 * Applies simple hysteresis (2 consecutive worse reads to change level).
 */
function snapshot() {
  const now = Date.now();
  const bots = {};
  for (const [botId, entry] of Object.entries(registry)) {
    let lastTickAgoMs = null;
    if (entry.lastTickAt) {
      const t = new Date(entry.lastTickAt).getTime();
      if (Number.isFinite(t)) lastTickAgoMs = now - t;
    }

    let rawLevel = 'green';
    const stale = lastTickAgoMs != null && lastTickAgoMs > warnStaleMs;
    const alert = lastTickAgoMs != null && lastTickAgoMs > alertStaleMs;
    const slow  = entry.loopDurationMs != null && entry.loopDurationMs > warnLoopMs;

    if (entry.status === 'stopped' || alert) rawLevel = 'red';
    else if (stale || slow) rawLevel = 'yellow';

    const current = entry.confirmedLevel || rawLevel;
    if (levelOrder[rawLevel] > levelOrder[current]) {
      entry.degradeCount = (entry.degradeCount || 0) + 1;
      if (entry.degradeCount >= 2) {
        entry.confirmedLevel = rawLevel;
        entry.degradeCount = 0;
      }
    } else {
      entry.confirmedLevel = rawLevel;
      entry.degradeCount = 0;
    }

    bots[botId] = {
      ...entry,
      lastTickAgoMs,
      healthLevel: entry.confirmedLevel || rawLevel,
    };
  }
  return { ts: new Date().toISOString(), bots };
}

module.exports = { update, snapshot };
