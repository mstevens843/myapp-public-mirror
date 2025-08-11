/**
 * Feature flag helper
 *
 * Provides a simple mechanism to enable or disable backend functionality at
 * runtime via environment variables. Flags are namespaced with a
 * `FEATURE_` prefix. For example, setting `FEATURE_IDEMPOTENCY=1` will
 * enable idempotency middleware globally. Flags are cached on first read
 * to avoid repeated environment lookups.
 */

const cache = {};

function isEnabled(name) {
  const key = String(name || '').toUpperCase();
  if (key in cache) return cache[key];
  const envVar = process.env[`FEATURE_${key}`];
  // treat '1', 'true', 'yes' (case insensitive) as enabled
  const enabled = typeof envVar === 'string' && /^(1|true|yes)$/i.test(envVar.trim());
  cache[key] = enabled;
  return enabled;
}

module.exports = { isEnabled };