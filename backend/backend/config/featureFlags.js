/**
 * Feature flag configuration
 *
 * This module centralises runtime feature flags for the backend.  Flags are
 * derived from environment variables so they can be adjusted without
 * redeploying the application.  There are two primary controls:
 *
 * 1. DISABLED_STRATEGIES – a comma‑separated list of strategy names that
 *    should not be allowed to launch.  Requests to start these strategies
 *    will return HTTP 503 Service Unavailable.
 *
 * 2. DISABLED_ENDPOINTS – a comma‑separated list of API path prefixes
 *    (starting with a slash) to disable.  If a request’s path begins with
 *    one of these prefixes the API router will short‑circuit and return
 *    HTTP 503.
 *
 * Example: set `DISABLED_STRATEGIES=sniper,scalper` and
 * `DISABLED_ENDPOINTS=/mode,/manual` in your environment to disable the
 * corresponding functionality.
 */

function parseList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Extract disabled strategies and endpoints from env
const disabledStrategies = parseList(process.env.DISABLED_STRATEGIES);
const disabledEndpoints = parseList(process.env.DISABLED_ENDPOINTS);

/**
 * Returns true if the given strategy name is enabled.
 *
 * @param {string} name Strategy key (e.g. `sniper`)
 */
function isStrategyEnabled(name) {
  return !disabledStrategies.includes(String(name));
}

/**
 * Returns true if the given request path is enabled.
 *
 * @param {string} path Request URL path (e.g. `/mode/start`)
 */
function isEndpointEnabled(path) {
  return !disabledEndpoints.some((p) => path.startsWith(p));
}

module.exports = {
  disabledStrategies,
  disabledEndpoints,
  isStrategyEnabled,
  isEndpointEnabled,
};