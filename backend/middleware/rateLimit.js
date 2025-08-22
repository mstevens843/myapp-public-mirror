/*
 * backend/middleware/rateLimit.js
 *
 * Modified to be effectively "no-op" for normal users:
 *  - Huge defaults (basically unnoticeable).
 *  - Metrics still record if someone truly floods.
 *  - Keeps API surface unchanged for imports.
 */

// Robust import for both CJS/ESM builds of express-rate-limit v7
const erl = require("express-rate-limit");
const rateLimit = erl.default || erl;
const ipKeyGenerator = erl.ipKeyGenerator || ((req) => req.ip);

let metrics;
try { metrics = require("./metrics"); } catch {}

/**
 * Parse a count from env safely.
 * - Allows digits, commas, underscores, and spaces (removed).
 * - Accepts exponent forms like "1e6".
 * - Falls back to provided default if invalid/non-positive.
 */
function parseCount(val, fallback) {
  const raw = (val ?? "").toString().trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/[_\s,]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Creates a generic rate limiter. Defaults are set extremely high so
 * normal usage will never hit it. You can override via env vars.
 */
function createRateLimiter(options = {}) {
  // Default: 1,000,000 requests / 15 min (~1,111 rps) → effectively "no-op".
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10); // 15m
  const max = parseCount(process.env.RATE_LIMIT_MAX_REQUESTS, 1_000_000);

  // Use user id when present; otherwise use ipKeyGenerator (required by ERL v7)
  const defaultKeyGen = (req, res) =>
    (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req, res));

  const handler =
    options.handler ||
    ((req, res) => res.status(429).json({ error: "Rate limit exceeded" }));

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || defaultKeyGen,
    handler,
    ...options,
  });

  // Boot log for sanity
  if (process.env.NODE_ENV !== "production") {
    console.log(
      "[rateLimit] global windowMs=%d max=%d (env=%j)",
      windowMs,
      max,
      process.env.RATE_LIMIT_MAX_REQUESTS
    );
  }
  return limiter;
}

/**
 * Authentication limiter — still stricter than generic, but raised way up
 * so it only catches *true* brute-force attempts.
 * Default: 5,000 requests / 15 min (~5.5 rps).
 */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: parseCount(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 5_000),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req, res)),
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
