/*
 * What changed / Why / Risk addressed
 *
 * This module previously contained a minimal logger that hard‑coded a small
 * list of sensitive keys and implemented its own recursive redaction.  The
 * list did not include important headers such as authorisation or cookie
 * values and did not support case‑insensitive matching.  As part of the
 * security hardening pass we centralise sensitive field handling by using
 * the new `utils/redact` helper.  It performs deep, case‑insensitive
 * redaction of headers and JSON bodies to ensure secrets never reach logs.
 *
 * In addition to the existing structured logging functions (info, warn,
 * error) we now expose an optional `httpLogger` middleware for Express.
 * When used, this middleware logs each request and response with headers
 * and bodies passed through the redaction helper.  It is not applied by
 * default so behaviour is unchanged unless explicitly wired into the
 * middleware chain.  This avoids any inadvertent changes to existing log
 * formats while providing a ready‑made sanitised HTTP logger.
 */

const { redactByKeys } = require('../utils/redact');

/**
 * Wrapper around the central redaction helper.  Retained for backward
 * compatibility with existing calls to `redact()` in this module.  It
 * simply delegates to `redactByKeys` using its default sensitive key list.
 *
 * @param {any} value Metadata object to sanitise
 * @returns {any} Sanitised copy of the object
 */
function redact(value) {
  return redactByKeys(value);
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
  /**
   * Express middleware to log incoming requests and their corresponding
   * responses with sanitised headers and bodies.  This middleware is
   * intentionally exported but not wired into the application by default.
   * To use it, import the module and add `app.use(logger.httpLogger)` in
   * your server configuration.  The logged objects include only redacted
   * copies of headers and request bodies and therefore will not leak
   * secrets such as tokens, cookies, JWTs or passphrases.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {Function} next
   */
  httpLogger: function httpLogger(req, res, next) {
    const start = Date.now();
    try {
      const reqInfo = {
        method: req.method,
        url: req.originalUrl || req.url,
        headers: redactByKeys(req.headers || {}),
        body: redactByKeys(req.body || {}),
      };
      console.log(format('HTTP', `→ ${reqInfo.method} ${reqInfo.url}`, reqInfo));
    } catch (e) {
      // Fail open on logging errors
      console.error('HTTP logger error (request):', e.message);
    }
    res.on('finish', () => {
      try {
        const respInfo = {
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: res.statusCode,
          headers: redactByKeys(typeof res.getHeaders === 'function' ? res.getHeaders() : {}),
          durationMs: Date.now() - start,
        };
        console.log(format('HTTP', `← ${respInfo.method} ${respInfo.url}`, respInfo));
      } catch (e) {
        console.error('HTTP logger error (response):', e.message);
      }
    });
    return next();
  },
};