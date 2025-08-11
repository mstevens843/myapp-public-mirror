
/**
 * Assigns a unique identifier to each incoming request.  The identifier is
 * attached to the request object (req.id) and exposed via the Xā€‘Requestā€‘Id
 * response header.  Downstream loggers can use this ID to correlate logs
 * across async boundaries.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const { v4: uuid } = require("uuid");

function requestId(req, res, next) {
  // Derive a request ID from the inbound header (if provided) or generate a new UUID.
  // This ID is attached to the request object and also surfaced on the response
  // as the `X-Request-Id` header so downstream clients and logs can correlate
  // individual request flows. If a client supplies an X-Request-Id header we
  // honour it; otherwise we generate a fresh UUID. Do not allow blank IDs.
  const header = (req.headers['x-request-id'] || '').toString().trim();
  req.id = header || uuid();
  // Expose the request ID in the response header to aid correlation. Some
  // existing code references req.id for logs and metrics so we continue to
  // populate it here.
  try {
    res.setHeader('X-Request-Id', req.id);
  } catch (_) {
    // In tests the res object may be a mock without setHeader
  }
  next();
}

module.exports = requestId;