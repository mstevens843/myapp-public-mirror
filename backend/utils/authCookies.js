/**
 * Helpers for setting and clearing authentication cookies. Centralising this
 * logic ensures consistent flags across the application and makes it easy to
 * adjust TTLs or cookie names from a single place. Cookies are set with
 * httpOnly and sameSite=Lax for CSRF protection. The `secure` flag is set
 * based on NODE_ENV so that cookies are sent over HTTPS in production.
 *
 * Excerpt merge: we also set __Host- prefixed cookies (when possible) to
 * harden against cookie fixation and ensure path=/, secure, and no Domain.
 * Legacy cookie names are preserved for backward compatibility.
 */

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Centralised cookie bases. We keep legacy Lax for backwards compat while
// adding hardened __Host- variants with Strict.
const cookieBaseLegacy = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
};

const cookieBaseHost = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  path: '/', // required for __Host- prefix
};

/**
 * Set the short‑lived access token cookie.
 *
 * @param {import('express').Response} res
 * @param {string} token
 */
function setAccessCookie(res, token) {
  // Legacy cookie (preserved)
  res.cookie('access_token', token, {
    ...cookieBaseLegacy,
    maxAge: ACCESS_TOKEN_TTL_MS,
  });
  // Hardened cookie (new)
  res.cookie('__Host-access_token', token, {
    ...cookieBaseHost,
    maxAge: ACCESS_TOKEN_TTL_MS,
  });
}

/**
 * Set the refresh token cookie. Rotated on each refresh.
 *
 * @param {import('express').Response} res
 * @param {string} token
 */
function setRefreshCookie(res, token) {
  // Legacy cookie (preserved)
  res.cookie('refresh_token', token, {
    ...cookieBaseLegacy,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
  // Hardened cookie (new)
  res.cookie('__Host-refresh_token', token, {
    ...cookieBaseHost,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

/**
 * Clear both access and refresh cookies. Useful on logout or auth failure.
 *
 * @param {import('express').Response} res
 */
function clearAuthCookies(res) {
  // Clear legacy cookies
  res.clearCookie('access_token', cookieBaseLegacy);
  res.clearCookie('refresh_token', cookieBaseLegacy);
  // Clear hardened cookies
  res.clearCookie('__Host-access_token', cookieBaseHost);
  res.clearCookie('__Host-refresh_token', cookieBaseHost);
  // It is safe to clear the CSRF token cookie here as well when logging out.
  res.clearCookie('csrf_token', { ...cookieBaseLegacy, httpOnly: false });
}

module.exports = {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
};