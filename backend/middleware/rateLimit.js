/*
 * backend/middleware/rateLimit.js
 *
 * What changed
 *  - Kept your limiter defaults and options passthrough.
 *  - Added optional metrics hook: recordRateLimitHit() on 429 for both generic and auth limiters.
 *  - If a custom handler is supplied via options, we wrap it to also record the metric.
 * Why
 *  - Visibility into rate-limit rejections without changing your configuration surface.
 * Risk addressed
 *  - No telemetry on throttling; retains original behavior for callers that pass a custom handler.
 */

const rateLimit = require('express-rate-limit');
let metrics; try { metrics = require('./metrics'); } catch {}

/**
 * Creates a generic rate limiter.  The defaults can be overridden via
 * environment variables.  You can also pass an options object to further
 * customise per-route behaviour (e.g. different max or skip conditions).
 *
 * If you provide your own `options.handler`, it will still increment the
 * rate-limit metric before invoking your handler.
 *
 * @param {import('express-rate-limit').Options} [options] Additional options
 */
function createRateLimiter(options = {}) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15m
  const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '300', 10);

  // Wrap a caller-supplied handler to record the metric as well.
  const userHandler = options.handler;
  const handler = (req, res, next) => {
    try {
      if (metrics && typeof metrics.recordRateLimitHit === 'function') {
        metrics.recordRateLimitHit();
      }
    } catch {}
    if (typeof userHandler === 'function') {
      return userHandler(req, res, next);
    }
    return res.status(429).json({ error: 'Rate limit exceeded' });
  };

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler,
    ...options,
  });
}

// A more aggressive limiter intended for authentication or other high-risk
// endpoints.  This can help mitigate brute force attempts.  Limits can be
// tuned via env vars AUTH_RATE_LIMIT_MAX_REQUESTS and AUTH_RATE_LIMIT_WINDOW_MS.
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '50', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    try {
      if (metrics && typeof metrics.recordRateLimitHit === 'function') {
        metrics.recordRateLimitHit();
      }
    } catch {}
    return res.status(429).json({ error: 'Rate limit exceeded' });
  },
});

module.exports = { createRateLimiter, authLimiter };
