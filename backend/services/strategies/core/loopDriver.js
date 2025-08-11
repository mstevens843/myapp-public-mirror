// Updated strategy loop driver with Prometheus instrumentation.
//
// In addition to emitting health telemetry via `emitHealth`, this
// version records the duration of each loop iteration to a Prometheus
// histogram.  The metric is labelled by the strategy name (passed via
// `opts.label` or falling back to the supplied `botId`).

const { lastTickTimestamps } = require('../../utils/strategy_utils/activeStrategyTracker');
const { emitHealth } = require('../logging/emitHealth');
const metrics = require('../core/metrics');

/**
 * Generic driver for running a strategy loop on a timer.
 *
 * In addition to invoking the provided `tick()` handler, this driver
 * automatically emits health telemetry on each iteration.  The health
 * payload includes the timestamp of the last tick, the duration of the
 * loop iteration, a static restartCount (incremented on restarts by the
 * parent process if desired), and a status of "running".  When the
 * process exits gracefully the driver marks the bot as "stopped".
 * A Prometheus histogram is also updated with the loop duration for
 * observability.
 *
 * @param {Function} tick   Async function invoked on each interval
 * @param {number}   intervalMs  Delay between invocations in milliseconds
 * @param {object}   opts   Options object ({ label, botId, immediate })
 * @returns {NodeJS.Timeout|null} The interval handle, or null if no interval
 */
function runStrategyLoop(tick, intervalMs, opts = {}) {
  const { label, botId = 'manual' } = opts;
  let running = false; // simple mutex
  let restartCount = 0;

  // Emit a "stopped" status on process exit so the health registry knows
  // when a bot has terminated cleanly.
  process.on('exit', () => {
    emitHealth(botId, { status: 'stopped' });
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
        status: 'running',
      });
      // Update Prometheus histogram for loop duration.  Use the
      // user‑supplied label when provided otherwise fall back to the
      // botId.  Duration is recorded in milliseconds but converted to
      // seconds inside the metrics helper.
      const name = label || botId || 'unknown';
      metrics.recordStrategyLoop(name, duration);
      running = false;
    }
  }

  // Fire once immediately
  wrapped();
  // If intervalMs > 0 schedule recurring invocations
  if (intervalMs > 0) return setInterval(wrapped, intervalMs);
  return null;
}

module.exports = runStrategyLoop;