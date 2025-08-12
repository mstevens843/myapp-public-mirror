// backend/middleware/requestId.js

/**
 * Assigns a unique identifier to each incoming request. The identifier is
 * attached to the request object (req.id) and exposed via the X-Request-Id
 * response header. Downstream loggers can use this ID to correlate logs
 * across async boundaries.
 *
 * Behavior:
 *  - If client supplies X-Request-Id, we honor it.
 *  - Otherwise we generate a UUID v4.
 */

const { v4: uuid } = require('uuid');

function requestId(req, res, next) {
  // Derive a request ID from the inbound header (if provided) or generate a new UUID.
  const header =
    (req.headers['x-request-id'] || req.headers['X-Request-Id'] || '').toString().trim();

  req.id = header || uuid();

  // Expose the request ID in the response header to aid correlation.
  try {
    res.setHeader('X-Request-Id', req.id);
  } catch (_) {
    // In tests the res object may be a mock without setHeader
  }

  // Also stash on locals for downstream middlewares/loggers.
  try {
    res.locals = res.locals || {};
    res.locals.requestId = req.id;
  } catch (_) {}

  next();
}

module.exports = requestId;
