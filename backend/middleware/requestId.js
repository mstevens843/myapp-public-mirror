
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

function requestId(req, _res, next) {
  req.id = (req.headers["x-request-id"] || "").toString().trim() || uuid();
  next();
}

module.exports = requestId;