// core/loopDriver.js
const { lastTickTimestamps } = require("../../utils/strategy_utils/activeStrategyTracker");
// Import the health emitter.  This helper writes to an in-memory
// registry and logs structured lines prefixed with `[HEALTH]`.
const { emitHealth } = require("../logging/emitHealth");

/**
 * Generic driver for running a strategy loop on a timer.
 *
 * In addition to invoking the provided `tick()` handler, this driver
 * automatically emits health telemetry on each iteration.  The health
 * payload includes the timestamp of the last tick, the duration of the
 * loop iteration, a static restartCount (incremented on restarts by the
 * parent process if desired), and a status of "running".  When the
 * process exits gracefully the driver marks the bot as "stopped".
 *
 * @param {Function} tick   Async function invoked on each interval
 * @param {number}   intervalMs  Delay between invocations in milliseconds
 * @param {object}   opts   Options object ({ label, botId, immediate })
 * @returns {NodeJS.Timeout|null} The interval handle, or null if no interval
 */
function runStrategyLoop(tick, intervalMs, opts = {}) {
  const { label, botId = "manual" } = opts;
  let running = false;              // 🔒 simple mutex
  let restartCount = 0;

  // Emit a "stopped" status on process exit so the health registry knows
  // when a bot has terminated cleanly.
  process.on("exit", () => {
    emitHealth(botId, { status: "stopped" });
  });

  async function wrapped() {
    // Skip if the previous tick is still running
    if (running) return;
    running = true;
    const start = Date.now();
    try {
      lastTickTimestamps[botId] = Date.now();
      await tick();
    } catch (err) {
      // Let errors bubble up to the parent; health still emitted
      throw err;
    } finally {
      const duration = Date.now() - start;
      // Emit telemetry so the UI can monitor liveness and loop duration.
      emitHealth(botId, {
        lastTickAt: new Date().toISOString(),
        loopDurationMs: duration,
        restartCount,
        status: "running",
      });
      running = false;
    }
  }

  // Fire once immediately
  wrapped();
  // If intervalMs>0 schedule recurring invocations
  if (intervalMs > 0) return setInterval(wrapped, intervalMs);
  return null;
}

module.exports = runStrategyLoop;