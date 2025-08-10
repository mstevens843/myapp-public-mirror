const rateLimit = require('express-rate-limit');

/**
 * Creates a generic rate limiter.  The defaults can be overridden via
 * environment variables.  You can also pass an options object to further
 * customise per‑route behaviour (e.g. different max or skip conditions).
 *
 * @param {import('express-rate-limit').Options} [options] Additional options
 */
function createRateLimiter(options = {}) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15m
  const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '300', 10);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
  });
}

// A more aggressive limiter intended for authentication or other high‑risk
// endpoints.  This can help mitigate brute force attempts.  Limits can be
// tuned via env vars AUTH_RATE_LIMIT_MAX_REQUESTS and AUTH_RATE_LIMIT_WINDOW_MS.
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '50', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { createRateLimiter, authLimiter };