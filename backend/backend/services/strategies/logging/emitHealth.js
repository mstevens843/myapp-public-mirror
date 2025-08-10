/*
 * Emit health telemetry for a strategy loop.
 *
 * Strategies can call this helper at the start and end of their main
 * loop to report operational metrics. The payload is merged into
 * the in-memory registry (via botHealthRegistry.update). In addition
 * to updating the registry directly, this helper writes a structured
 * log line to stdout prefixed with `[HEALTH]`. The strategy launcher
 * can parse these lines to update the registry in the parent process
 * without requiring direct invocation of update() inside worker
 * processes.
 */

const { update } = require('../../health/botHealthRegistry');

/**
 * Emit a health update for a given bot. The payload may contain any
 * subset of the following fields: lastTickAt (ISO string), loopDurationMs
 * (number), restartCount (number), status (string), notes (string).
 *
 * @param {string} botId Unique identifier for the running bot
 * @param {object} payload Partial health metrics
 */
function emitHealth(botId, payload = {}) {
  if (!botId) return;
  // Persist metrics into the central registry when running in the same
  // process. This is useful for unit tests or single-process mode.
  try {
    update(botId, payload);
  } catch {
    /* swallow errors to avoid breaking the strategy loop */
  }
  // Compose a compact JSON object with only defined properties. This
  // prevents undefined values from appearing in the logs.
  const out = { botId };
  ['lastTickAt', 'loopDurationMs', 'restartCount', 'status', 'notes'].forEach(
    (key) => {
      if (payload[key] !== undefined && payload[key] !== null) {
        out[key] = payload[key];
      }
    },
  );
  try {
    // Print the line to stdout so the parent process can intercept
    // and parse it. The `[HEALTH]` prefix distinguishes telemetry
    // from ordinary logs.
    const line = `[HEALTH]${JSON.stringify(out)}`;
    console.log(line);
  } catch {
    /* ignore logging errors */
  }
}

module.exports = { emitHealth };