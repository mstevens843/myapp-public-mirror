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
const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refreshToken',
  'secret',
  'privateKey',
  'apiKey',
  'jwt',
  'cookies',
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
  if (value && typeof value === 'object') {
    // Handle arrays separately to preserve order
    if (Array.isArray(value)) {
      return value.map((v) => redact(v));
    }
    const output = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.includes(k)) {
        output[k] = '[REDACTED]';
      } else if (typeof v === 'object') {
        output[k] = redact(v);
      } else {
        output[k] = v;
      }
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

function log(level, message, meta) {
  // Write synchronously to stdout.  In high throughput scenarios you may
  // wish to buffer or use a proper logging library instead.
  console.log(format(level, message, meta || {}));
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  debug: (msg, meta) => log('DEBUG', msg, meta),
  log,
};