/**
 * Helpers for setting and clearing authentication cookies. Centralising this
 * logic ensures consistent flags across the application and makes it easy to
 * adjust TTLs or cookie names from a single place. Cookies are set with
 * httpOnly and sameSite=Lax for CSRF protection. The `secure` flag is set
 * based on NODE_ENV so that cookies are sent over HTTPS in production.
 */

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Set the short‑lived access token cookie.
 *
 * @param {import('express').Response} res
 * @param {string} token
 */
function setAccessCookie(res, token) {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
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
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

/**
 * Clear both access and refresh cookies. Useful on logout or auth failure.
 *
 * @param {import('express').Response} res
 */
function clearAuthCookies(res) {
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  // It is safe to clear the CSRF token cookie here as well when logging out.
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
}

module.exports = {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
};