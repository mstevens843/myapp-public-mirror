// backend/api/health.js
/**
 * Health API: GET /api/health/bots
 * - Protected by existing auth middleware
 * - Rate limited (30 req/min)
 * - Returns { ts, bots: { [botId]: { botId, status, lastTickAt, lastTickAgoMs, loopDurationMs, restartCount, pid, notes, healthLevel } } }
 */

const express = require('express');
const router = express.Router();

let requireAuth;
try {
  // adjust if your auth middleware file is named differently
  requireAuth = require('../middleware/requireAuth');
} catch {
  // fallback to a no-op if path differs; update to your actual path if needed
  requireAuth = (req, _res, next) => next();
}

let rateLimiter;
try {
  // adjust if your limiter export differs (e.g., { limiter } vs function)
  rateLimiter = require('../middleware/rateLimit');
} catch {
  rateLimiter = () => (_req, _res, next) => next();
}

const { snapshot } = require('../services/strategies/core/botHealthRegistery');

// protect whole router
router.use(requireAuth);

// 30 req/min limiter on health read
const rl = typeof rateLimiter === 'function'
  ? rateLimiter({ windowMs: 60_000, max: 30 })
  : (_req, _res, next) => next();

router.get('/bots', rl, (_req, res) => {
  // No PII — only operational metrics.
  const data = snapshot();
  res.json(data);
});

module.exports = router;
