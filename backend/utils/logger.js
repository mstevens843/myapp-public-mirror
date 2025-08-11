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

// Import the centralised redaction helper.  This allows the list of
// sensitive keys to be maintained in one place and supports
// case‑insensitive matching.  Any new secrets added to
// utils/redact.js will automatically be picked up here without
// modifying this file.
const { redactByKeys } = require('../utils/redact');

/**
 * Wrapper that delegates to the shared redaction helper.  It exists to
 * preserve the original function signature (one argument) while
 * providing redaction that respects the unified list of sensitive
 * fields defined in utils/redact.js.  See that module for details.
 *
 * @param {any} value Metadata object to sanitise
 * @returns {any} Sanitised copy of the value
 */
function redact(value) {
  return redactByKeys(value);
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