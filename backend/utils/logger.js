/*
 * Structured logger with request ID propagation and secret redaction.
 *
 * This logger writes structured log lines to stdout.  Each message
 * includes an ISO8601 timestamp, the log level, and a request ID when
 * available.  Metadata objects are JSON stringified after removing any
 * sensitive keys such as tokens or API keys.  Downstream code can
 * simply call `logger.info('message', { some: 'data' })` and the
 * request ID will automatically be included if the call occurs within
 * an AsyncLocalStorage context initialised by `middleware/requestId`.
 */

const { getReqId } = require('./requestContext');

// Keys that should be redacted from log metadata to avoid leaking
// credentials or other sensitive information.  Extend this list as new
// types of secrets are introduced.
// NOTE: Merged with excerpt's additional keys (refresh_token, private_key, email, mnemonic, seed)
const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'refreshToken',
  'secret',
  'privateKey',
  'private_key',
  'apiKey',
  'jwt',
  'cookies',
  'email',
  'mnemonic',
  'seed',
];

/**
 * Recursively redact sensitive fields from an object.  Arrays and nested
 * objects are traversed.  Primitives are returned as-is.  When a
 * sensitive key is encountered its value is replaced with
 * "[REDACTED]".
 *
 * @param {any} value
 * @returns {any}
 */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [k, v] of Object.entries(value)) {
      output[k] = SENSITIVE_KEYS.includes(k) ? '[REDACTED]' : redact(v);
    }
    return output;
  }
  return value;
}

/**
 * Format a log message into a single line.  Prefixes the message with
 * timestamp, level and request ID (if present) and stringifies the
 * metadata object.  Sensitive fields are redacted.
 *
 * @param {string} level
 * @param {string} message
 * @param {object} [meta]
 * @returns {string}
 */
function format(level, message, meta) {
  const ts = new Date().toISOString();
  const reqId = getReqId() || (meta && meta.reqId);
  const parts = [`[${ts}]`, `[${level}]`];
  if (reqId) parts.push(`[req:${reqId}]`);
  parts.push(message);
  if (meta && Object.keys(meta).length) {
    // Clone meta to avoid mutating caller objects and remove reqId
    const { reqId: _, ...rest } = meta;
    parts.push(JSON.stringify(redact(rest)));
  }
  return parts.join(' ');
}

/* ===== Excerpt compatibility: minimal formatter & logger =====
 * The following functions mirror the previously provided excerpt so you can
 * switch to a minimal format if desired without losing the richer format above.
 * Nothing else in your app changes unless you call logger.logMinimal(...).
 */
function fmt(level, msg, meta) {
  const ts = new Date().toISOString();
  const parts = [ts, level, msg];
  if (meta) parts.push(JSON.stringify(redact(meta)));
  return parts.join(' ');
}

function log(level, message, meta) {
  // Write synchronously to stdout.  In high throughput scenarios you may
  // wish to buffer or use a proper logging library instead.
  console.log(format(level, message, meta || {}));
}

// Optional: expose a minimal logger that uses the excerpt's fmt
function logMinimal(level, message, meta) {
  console.log(fmt(level, message, meta));
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  debug: (msg, meta) => log('DEBUG', msg, meta),
  log,
  // Expose redact and both formatters for advanced usage/testing
  redact,
  format,
  fmt,
  logMinimal,
};