const crypto = require('crypto');

/**
 * Generate a random CSRF token. We rely on a cryptographically secure
 * random number generator to avoid predictable tokens. The length of 24
 * bytes (48 hex characters) is more than sufficient for CSRF protection.
 *
 * @returns {string}
 */
function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Express middleware that enforces a double‑submit CSRF protection pattern.
 * For non‑safe HTTP methods (anything other than GET/HEAD/OPTIONS), the
 * middleware checks for a 'x-csrf-token' header and verifies it matches
 * the value stored in the 'csrf_token' cookie. If tokens are missing or
 * mismatch it forwards a 403 error. This middleware should be placed
 * after cookie‑parser so that req.cookies is populated.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }
  const cookieToken = req.cookies && req.cookies['csrf_token'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next({ status: 403, message: 'Invalid CSRF token' });
  }
  return next();
}

module.exports = {
  generateCsrfToken,
  csrfProtection,
};