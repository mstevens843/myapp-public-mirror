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

const { update } = require('../core/botHealthRegistery');

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
    // Pretty human line (blue glow), does not affect parent parsers
    try {
      if (process.stdout && process.stdout.isTTY && process.env.NO_COLOR !== '1') {
        const BLUE = "\x1b[94m"; const BOLD="\x1b[1m"; const RESET="\x1b[0m";
        const short = `[HEALTH] tick ok — lastTickAt=${out.lastTickAt || payload.lastTickAt || "-"}, loop=${out.loopDurationMs ?? payload.loopDurationMs ?? "-"}ms, status=${out.status || payload.status || "running"}`;
        console.log(`${BOLD}${BLUE}${short}${RESET}`);
      }
    } catch {}

  } catch {
    /* ignore logging errors */
  }
}

module.exports = { emitHealth };