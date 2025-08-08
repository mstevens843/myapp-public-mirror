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
  const enableReportOnly = process.env.ENABLE_CSP_REPORT_ONLY === 'true';
  const cspOptions = enableReportOnly
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
          connectSrc: ["'self'", '*'],
          imgSrc: ["'self'", 'data:', '*'],
        },
        reportOnly: true,
      }
    : false;
  return helmet({
    contentSecurityPolicy: cspOptions,
    // We could also configure other Helmet modules here as needed.
  });
}

module.exports = securityHeaders;