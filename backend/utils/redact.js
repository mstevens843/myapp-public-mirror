/*
 * What changed / Why / Risk addressed
 *
 * Added a centralised redaction helper which deeply sanitises objects by
 * removing sensitive values.  Previously each logger defined its own
 * hard‑coded list of keys to redact which left gaps and duplicated logic.
 * This module exposes `redactByKeys` which walks nested objects and
 * arrays and replaces values for keys matching a case‑insensitive list
 * of sensitive fields (e.g. authorization, set‑cookie, cookie, jwt,
 * token, passphrase, secret, apikey).  Centralising the redaction logic
 * reduces the risk of accidentally leaking secrets into logs and makes it
 * easy to extend the list of sensitive keys in one place.
 */

/**
 * Default list of sensitive keys.  Keys are compared case‑insensitively.
 * When a key from this list is encountered anywhere in an object tree
 * the corresponding value is replaced with the string '[REDACTED]'.
 */
const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'set-cookie',
  'cookie',
  'jwt',
  'token',
  'passphrase',
  'secret',
  'apikey',
];

/**
 * Recursively walk an input value and redact sensitive fields.  Arrays are
 * traversed element by element; objects are traversed property by property.
 * Primitive values are returned as‑is.  The function never mutates the
 * original input – a new structure is returned to avoid side effects.
 *
 * @param {any} value The value to sanitise
 * @param {string[]} [sensitiveKeys] Optional override for the list of keys
 * @returns {any} A copy of the value with sensitive fields redacted
 */
function redactByKeys(value, sensitiveKeys = DEFAULT_SENSITIVE_KEYS) {
  // Build a Set of lower‑cased keys for O(1) lookups
  const lowerKeys = new Set(sensitiveKeys.map((k) => String(k).toLowerCase()));

  const _redact = (val) => {
    if (Array.isArray(val)) {
      return val.map((item) => _redact(item));
    }
    if (val && typeof val === 'object') {
      const output = {};
      for (const [k, v] of Object.entries(val)) {
        if (lowerKeys.has(k.toLowerCase())) {
          output[k] = '[REDACTED]';
        } else {
          output[k] = _redact(v);
        }
      }
      return output;
    }
    return val;
  };

  return _redact(value);
}

module.exports = {
  redactByKeys,
  DEFAULT_SENSITIVE_KEYS,
};