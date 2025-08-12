// backend/middleware/errorHandler.js

const logger = require('../utils/logger');

/**
 * Centralised error handling middleware.  It logs the full error using the
 * shared logger and returns a sanitized JSON response.  In production the
 * message is generic to avoid leaking internal state.  In development the
 * original error message is included to aid debugging.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  // Delegate to the logger with request context
  try {
    logger.error('Unhandled error', { err, reqId: req.id });
  } catch (_) {}

  const status = err.status || err.statusCode || 500;
  const exposeDetails = process.env.NODE_ENV !== 'production';

  res.status(status).json({
    error: exposeDetails ? (err.message || 'Internal server error') : 'Internal server error',
  });
}

module.exports = errorHandler;
