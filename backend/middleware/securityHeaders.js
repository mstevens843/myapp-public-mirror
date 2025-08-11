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
/**
 * Security headers middleware.
 * Uses Helmet for a strong baseline, with a strict CSP by default.
 * Set ENABLE_CSP_REPORT_ONLY=1 to switch CSP to report-only during rollout.
 */
const helmet = require("helmet");

function securityHeaders() {
  const isReportOnly = String(process.env.ENABLE_CSP_REPORT_ONLY || '').trim() === '1';

  const cspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "https:", "'unsafe-inline'"], // remove 'unsafe-inline' if not needed
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "https:", "data:"],
    connectSrc: ["'self'", "https:"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: [],
  };

  const csp = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: cspDirectives,
    reportOnly: isReportOnly,
  });

  const hsts = helmet.hsts({
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  });

  return [
    helmet.dnsPrefetchControl({ allow: false }),
    helmet.frameguard({ action: "deny" }),
    helmet.noSniff(),
    helmet.referrerPolicy({ policy: "no-referrer" }),
    helmet.permittedCrossDomainPolicies({ permittedPolicies: "none" }),
    helmet.crossOriginResourcePolicy({ policy: "same-site" }),
    hsts,
    csp,
  ];
}

module.exports = securityHeaders;