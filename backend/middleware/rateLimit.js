/*
 * backend/middleware/rateLimit.js
 *
 * Modified to be effectively "no-op" for normal users:
 *  - Huge defaults (basically unnoticeable).
 *  - Metrics still record if someone truly floods.
 *  - Keeps API surface unchanged for imports.
 */

const rateLimit = require("express-rate-limit");
let metrics; try { metrics = require("./metrics"); } catch {}

/**
 * Creates a generic rate limiter. Defaults are set extremely high so
 * normal usage will never hit it. You can override via env vars.
 */
function createRateLimiter(options = {}) {
  // Default: 100,000 requests / 15 min (~111 rps) → unnoticeable.
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10); // 15m
  const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000000", 10);

  const userHandler = options.handler;
  const handler = (req, res, next) => {
    try {
      if (metrics && typeof metrics.recordRateLimitHit === "function") {
        metrics.recordRateLimitHit();
      }
    } catch {}
    if (typeof userHandler === "function") {
      return userHandler(req, res, next);
    }
    return res.status(429).json({ error: "Rate limit exceeded" });
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

/**
 * Authentication limiter — still stricter than generic, but raised way up
 * so it only catches *true* brute-force attempts.
 * Default: 5,000 requests / 15 min (~5.5 rps).
 */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || "5000", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    try {
      if (metrics && typeof metrics.recordRateLimitHit === "function") {
        metrics.recordRateLimitHit();
      }
    } catch {}
    return res.status(429).json({ error: "Rate limit exceeded" });
  },
});

module.exports = { createRateLimiter, authLimiter };
