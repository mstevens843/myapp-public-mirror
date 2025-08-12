// backend/middleware/securityHeaders.js

/**
 * Security headers middleware.
 * Uses Helmet for a strong baseline, with a strict CSP by default.
 * Set ENABLE_CSP_REPORT_ONLY=1|true|yes to switch CSP to report-only during rollout.
 * Optionally set CSP_REPORT_URI to include a report-uri directive.
 */

const helmet = require('helmet');

function truthy(v) {
  return /^(1|true|yes)$/i.test(String(v || '').trim());
}

function securityHeaders() {
  const isReportOnly = truthy(process.env.ENABLE_CSP_REPORT_ONLY);

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
    // Optional: allow reporting endpoint if configured
    ...(process.env.CSP_REPORT_URI ? { reportUri: [process.env.CSP_REPORT_URI] } : {}),
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
    helmet.hidePoweredBy(),
    helmet.dnsPrefetchControl({ allow: false }),
    helmet.frameguard({ action: 'deny' }),
    helmet.noSniff(),
    helmet.referrerPolicy({ policy: 'no-referrer' }),
    helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' }),
    helmet.crossOriginResourcePolicy({ policy: 'same-site' }),
    hsts,
    csp,
  ];
}

module.exports = securityHeaders;
