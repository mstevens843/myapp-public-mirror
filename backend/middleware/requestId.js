const { v4: uuidv4 } = require('uuid');

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
function requestId(req, res, next) {
  const id = uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;