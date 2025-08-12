/**
 * backend/middleware/csrf.js
 *
 * What changed
 *  - Kept your double-submit CSRF logic intact.
 *  - Added optional metrics hook: recordCsrfDenial() on 403 (no behavior change otherwise).
 * Why
 *  - Improve visibility into CSRF denials without altering request handling.
 * Risk addressed
 *  - Lack of telemetry for CSRF violations.
 */

const crypto = require('crypto');
let metrics; try { metrics = require('./metrics'); } catch {}

const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME || 'csrf_token';

// Normalize SameSite from env: 'Strict' (default), 'Lax', or 'None'
function resolveSameSite() {
  const v = String(process.env.CSRF_SAMESITE || 'Strict').trim().toLowerCase();
  if (v === 'lax') return 'Lax';
  if (v === 'none') return 'None';
  return 'Strict';
}

function shouldUseSecure(sameSite) {
  // Chrome requires Secure when SameSite=None.
  // Otherwise: secure in prod, off in local HTTP dev.
  if (sameSite === 'None') return true;
  return process.env.NODE_ENV === 'production';
}

/** Generate a random CSRF token (32 bytes -> 64 hex chars). */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Set (or refresh) the CSRF cookie. Readable (httpOnly: false) for double-submit. */
function setCsrfCookie(res, token) {
  const sameSite = resolveSameSite();
  const secure = shouldUseSecure(sameSite);

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,              // must be readable by FE to mirror into header
    secure,
    sameSite,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

/**
 * Seed the CSRF cookie on safe requests if it's missing.
 * Put this AFTER cookieParser() but BEFORE your route handlers.
 */
function ensureCsrfSeed(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  const safe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (safe && !req.cookies?.[CSRF_COOKIE]) {
    setCsrfCookie(res, generateCsrfToken());
  }
  next();
}

/**
 * Double-submit CSRF check for unsafe methods.
 * Accepts `X-CSRF-Token` (preferred) or `X-XSRF-Token` aliases.
 */
function csrfProtection(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  const unsafe = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (!unsafe) return next();

  const header =
    req.get('X-CSRF-Token') ||
    req.get('X-XSRF-Token') ||
    '';

  const cookie = (req.cookies && req.cookies[CSRF_COOKIE]) || '';

  if (!header || !cookie || header !== cookie) {
    try {
      if (metrics && typeof metrics.recordCsrfDenial === 'function') {
        metrics.recordCsrfDenial();
      }
    } catch {}
    return res.status(403).json({ error: 'CSRF token invalid or missing' });
  }
  next();
}

module.exports = {
  CSRF_COOKIE,
  generateCsrfToken,
  setCsrfCookie,
  ensureCsrfSeed,
  csrfProtection,
};
