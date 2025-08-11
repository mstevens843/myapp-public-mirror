/**
 * Idempotency middleware
 *
 * This middleware implements basic idempotency semantics for HTTP requests
 * that mutate state (typically POST/PUT). When a client includes an
 * `Idempotency-Key` header with a UUID v4 value the server will persist
 * the initial response payload and status code. Subsequent calls with the
 * same key within the configured TTL window will return the previously
 * stored response instead of executing the handler again. Requests missing
 * the header pass straight through. A short TTL is used to prevent stale
 * keys from piling up in the database.
 *
 * Storage is handled via Prisma with the IdempotencyRecord model. Only
 * (userId,key) pairs are unique; this prevents collisions between different
 * users. To avoid impacting hot paths the middleware defers writes until
 * after the response has been sent.
 */

const crypto = require('crypto');
const prisma = require('../prisma/prisma');
const logger = require('../utils/logger');

// TTL (ms) for idempotency keys. After this period a key will be expired and
// removed by the cleanup job. Defaults to 10 minutes.
const IDEMPOTENCY_TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS, 10) || 10 * 60 * 1000;

/**
 * Express middleware function that enforces idempotency semantics.
 *
 * When the `Idempotency-Key` header is present the middleware will look up
 * any existing record for the current user. If found and not expired the
 * stored response is immediately sent and downstream handlers are skipped.
 * Otherwise the request proceeds normally. Once the handler finishes the
 * middleware persists the response details to the IdempotencyRecord table.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function idempotencyMiddleware(req, res, next) {
  const key = req.get('Idempotency-Key');
  // Only enforce idempotency on defined key and for authenticated users
  const userId = req.user && (req.user.id || req.user.userId || req.user.user_id);
  if (!key || !userId) return next();

  // Normalise header value and validate UUID v4 shape
  const trimmed = String(key).trim();
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidV4Regex.test(trimmed)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key' });
  }

  // Immediately attempt lookup. Note: this query should be cheap since
  // IdempotencyRecord has a composite unique index on (userId,key).
  prisma.idempotencyRecord
    .findUnique({ where: { userId_key: { userId, key: trimmed } } })
    .then((record) => {
      if (record) {
        const expired = record.expiresAt && new Date(record.expiresAt) < new Date();
        if (!expired) {
          // Replay the stored response. Status code and body are returned as-is.
          res.status(record.status);
          try {
            const payload = Buffer.isBuffer(record.payload)
              ? record.payload.toString()
              : record.payload;
            let body;
            try {
              body = JSON.parse(payload);
              return res.json(body);
            } catch (_) {
              return res.send(payload);
            }
          } catch (_) {
            return res.end();
          }
        }
      }
      // Not found or expired -> attach key to request for later persistence
      res.locals.idempotencyKey = trimmed;
      res.locals.idempotencyUserId = userId;
      // Override res.json and res.send to capture response body
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      res.json = function (body) {
        persistIdempotentResponse(this, body);
        return originalJson(body);
      };
      res.send = function (body) {
        persistIdempotentResponse(this, body);
        return originalSend(body);
      };
      return next();
    })
    .catch((err) => {
      logger.error('Idempotency lookup error', { err: err.message });
      return next();
    });

  function persistIdempotentResponse(response, body) {
    const { idempotencyKey: ikey, idempotencyUserId: uid } = res.locals;
    if (!ikey || !uid) return;
    // Compute hash of the response body for de-duplication and potential
    // integrity checks. Use SHA256.
    let payload;
    try {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    } catch (e) {
      payload = String(body);
    }
    const resultHash = crypto.createHash('sha256').update(payload).digest('hex');
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
    const status = response.statusCode;
    // Persist asynchronously; don't block the response
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
        // Duplicate key errors are ignored (another concurrent request
        // persisted first). We log other errors for investigation.
        if (err.code !== 'P2002') {
          logger.error('Failed to persist idempotency record', { err: err.message });
        }
      });
    // Remove locals to avoid multiple writes
    res.locals.idempotencyKey = undefined;
    res.locals.idempotencyUserId = undefined;
  }
}

module.exports = idempotencyMiddleware;