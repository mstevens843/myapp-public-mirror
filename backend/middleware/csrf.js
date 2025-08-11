const crypto = require('crypto');
const CSRF_COOKIE = "csrf_token";

/**
 * Generate a random CSRF token. We rely on a cryptographically secure
 * random number generator to avoid predictable tokens. The length of 24
 * bytes (48 hex characters) is more than sufficient for CSRF protection.
 *
 * @returns {string}
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
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
const crypto = require("crypto");


function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function csrfProtection(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!unsafe) return next();

  const header = req.get("X-CSRF-Token") || "";
  const cookie = (req.cookies && req.cookies[CSRF_COOKIE]) || "";
  if (!header || !cookie || header !== cookie) {
    return res.status(403).json({ error: "CSRF token invalid or missing" });
  }
  return next();
}

module.exports = { csrfProtection, generateCsrfToken, setCsrfCookie, CSRF_COOKIE };