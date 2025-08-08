/*
 * Simple structured logger with secret redaction and request ID awareness.
 *
 * This logger writes to stdout using console.log but first sanitises any
 * objects passed as metadata.  Keys matching known sensitive patterns (e.g.
 * "password", "token", "secret", etc.) are replaced with "[REDACTED]".  To
 * maintain minimal dependencies and footprint we avoid pulling in heavy
 * logging frameworks.  If integration with an external log aggregator is
 * desired a custom transport can be added here later.
 */

const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refreshToken',
  'secret',
  'privateKey',
  'apiKey',
];

function redact(value) {
  if (value && typeof value === 'object') {
    const output = Array.isArray(value) ? [] : {};
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

function format(level, message, meta) {
  const ts = new Date().toISOString();
  const parts = [`[${ts}]`, `[${level}]`, message];
  if (meta && Object.keys(meta).length) {
    parts.push(JSON.stringify(redact(meta)));
  }
  return parts.join(' ');
}

function log(level, message, meta) {
  // In production we might route logs elsewhere.  For now log to stdout.
  console.log(format(level, message, meta));
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  log,
};