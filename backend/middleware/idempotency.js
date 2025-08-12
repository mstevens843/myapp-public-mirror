/**
 * backend/middleware/idempotency.js
 *
 * What changed
 *  - Keeps your header-driven idempotency (Idempotency-Key) for backward compatibility.
 *  - Adds deterministic fallback key: SHA256(userId|path|normalizedBody|IDEMPOTENCY_SALT).
 *  - Switches TTL to prefer IDEMPOTENCY_TTL_SEC (fallback to IDEMPOTENCY_TTL_MS, default 600s).
 *  - Records metrics on idempotency replays (if metrics middleware is present).
 * Why
 *  - Prevent duplicate POST side-effects even when the client doesn’t supply a key.
 * Risk addressed
 *  - Duplicate trade/order creation due to retries/timeouts; cache poisoning mitigated by per-user composite key.
 */

/**
 * Idempotency middleware
 *
 * This middleware implements idempotency semantics for HTTP requests
 * that mutate state (typically POST). It supports two modes:
 *
 *  1) Header mode (existing): client supplies `Idempotency-Key` (UUID v4).
 *     We persist the first response and replay it for subsequent requests
 *     with the same key (within TTL).
 *
 *  2) Deterministic mode (new, fallback): if no header is present, we derive
 *     a key as SHA256(userId|path|normalizedBody|IDEMPOTENCY_SALT). This
 *     makes idempotency work automatically for safe retries.
 *
 * Storage is handled via Prisma with the IdempotencyRecord model. Only
 * (userId,key) pairs are unique to prevent cross-user collisions.
 */

'use strict';

const crypto = require('crypto');
const prisma = require('../prisma/prisma');
const logger = require('../utils/logger');
let metrics;
try { metrics = require('./metrics'); } catch { metrics = null; }

// TTL preference: IDEMPOTENCY_TTL_SEC first, fallback to IDEMPOTENCY_TTL_MS, default 600s.
const TTL_SEC = (() => {
  const sec = parseInt(process.env.IDEMPOTENCY_TTL_SEC || '0', 10);
  if (Number.isFinite(sec) && sec > 0) return sec;
  const ms = parseInt(process.env.IDEMPOTENCY_TTL_MS || '0', 10);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
  return 600;
})();

const SALT = String(process.env.IDEMPOTENCY_SALT || '');

/** Normalize a JS value with stable key ordering for hashing. */
function normalise(val) {
  if (val == null) return '';
  if (Array.isArray(val)) return '[' + val.map(normalise).join(',') + ']';
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    return '{' + keys.map((k) => `${k}:${normalise(val[k])}`).join(',') + '}';
  }
  return String(val);
}

/**
 * Derive deterministic idempotency key from user, path and normalized body.
 * @param {string} userId
 * @param {string} path
 * @param {any} body
 */
function deriveIdKey(userId, path, body) {
  const serialised = normalise(body);
  const raw = `${userId}|${path}|${serialised}|${SALT}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Express middleware enforcing idempotency.
 * Expects to run AFTER authentication (req.user must exist).
 *
 * Header mode: uses validated UUID v4 from `Idempotency-Key`.
 * Fallback mode: derives key from userId|path|body|salt.
 *
 * Replays stored response if found & unexpired; otherwise captures and persists.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function idempotencyMiddleware(req, res, next) {
  try {
    // Router already gates to POST; keeping method-agnostic here is fine.
    const userId = req.user && (req.user.id || req.user.userId || req.user.user_id);
    if (!userId) return next();

    // Prefer client key if present (back-compat), else use deterministic key.
    let key = null;
    const headerKey = req.get('Idempotency-Key');
    if (headerKey) {
      const trimmed = String(headerKey).trim();
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidV4Regex.test(trimmed)) {
        return res.status(400).json({ error: 'Invalid Idempotency-Key' });
      }
      key = trimmed;
    } else {
      key = deriveIdKey(userId, req.path, req.body);
    }

    // Lookup cached response (composite unique index userId+key).
    const record = await prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });
    const now = new Date();
    if (record && record.expiresAt && new Date(record.expiresAt) > now) {
      if (metrics && typeof metrics.recordIdempotencyReplay === 'function') {
        try { metrics.recordIdempotencyReplay(); } catch {}
      }
      res.status(record.status);
      try {
        const payload = Buffer.isBuffer(record.payload) ? record.payload.toString() : record.payload;
        try {
          const body = JSON.parse(payload);
          return res.json(body);
        } catch {
          return res.send(payload);
        }
      } catch {
        return res.end();
      }
    }

    // Not found or expired – attach key and user for capture after handler runs
    res.locals.idempotencyKey = key;
    res.locals.idempotencyUserId = userId;

    // Wrap send/json to persist the first response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function (body) {
      persistResponse(this, body);
      return originalJson(body);
    };
    res.send = function (body) {
      persistResponse(this, body);
      return originalSend(body);
    };

    return next();
  } catch (err) {
    try { logger.error('Idempotency middleware error', { err: err.message }); } catch {}
    return next();
  }

  function persistResponse(response, body) {
    const ikey = res.locals.idempotencyKey;
    const uid = res.locals.idempotencyUserId;
    if (!ikey || !uid) return;

    let payload;
    try {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    } catch {
      payload = String(body);
    }
    const resultHash = crypto.createHash('sha256').update(payload).digest('hex');
    const expiresAt = new Date(Date.now() + TTL_SEC * 1000);
    const status = response.statusCode;

    prisma.idempotencyRecord
      .create({
        data: {
          userId: uid,
          key: ikey,
          status,
          resultHash,
          payload: Buffer.from(payload),
          createdAt: new Date(),
          expiresAt,
        },
      })
      .catch((err) => {
        // Ignore duplicate key races; surface other errors.
        if (err && err.code !== 'P2002') {
          try { logger.error('Failed to persist idempotency record', { err: err.message }); } catch {}
        }
      });

    // Clear to avoid double persistence on multiple res writes
    res.locals.idempotencyKey = undefined;
    res.locals.idempotencyUserId = undefined;
  }
}

module.exports = idempotencyMiddleware;
