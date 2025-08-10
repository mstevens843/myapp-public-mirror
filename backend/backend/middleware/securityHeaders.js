const helmet = require('helmet');

/**
 * Configures a set of HTTP security headers using Helmet.  By default we
 * disable the Content Security Policy to avoid breaking existing frontend
 * scripts.  To experiment with CSP in report‑only mode, set
 * `ENABLE_CSP_REPORT_ONLY=true` in your environment.  When enabled the
 * directives are deliberately permissive but will log violations to the
 * browser console.  Hardening CSP further should be tackled as a follow‑up.
 *
 * @returns {import('express').RequestHandler} Helmet middleware
 */
function securityHeaders() {
  const reportOnly = process.env.ENABLE_CSP_REPORT_ONLY !== 'false';
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
    imgSrc: ["'self'", 'data:', 'blob:', '*'],
    connectSrc: ["'self'", '*'],
    fontSrc: ["'self'", 'https:'],
    objectSrc: ["'none'"]
  };
  const cspOptions = { directives: cspDirectives, reportOnly };
  return helmet({
    // Always enable CSP.  When reportOnly is true, Helmet will deliver
    // Content‑Security‑Policy‑Report‑Only headers instead of enforcing them.
    contentSecurityPolicy: cspOptions,
  });
}

module.exports = securityHeaders;