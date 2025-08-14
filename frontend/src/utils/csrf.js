// src/utils/csrf.js
// What changed
// - Robust CSRF retrieval:
//   * Reads token from cookie (default "csrfid") when server only sets cookie.
//   * Still supports JSON body { token } or response header X-CSRF-Token.
// - In-memory cache, plus a single pending fetch coalescer.
// - Exports: getCsrfToken, ensureCsrfToken, setCsrfToken, clearCsrfToken,
//   CSRF_HEADER_NAME, CSRF_COOKIE_NAME, default bundle.

const CSRF_HEADER_NAME = import.meta?.env?.VITE_CSRF_HEADER_NAME || "X-CSRF-Token";
const CSRF_COOKIE_NAME = import.meta?.env?.VITE_CSRF_COOKIE_NAME || "csrfid";

let _csrf = null;
let _pending = null;

function readCookie(name) {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1")}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function joinUrl(base, path) {
  try {
    if (!path) return base || "/";
    if (/^https?:\/\//i.test(path)) return path;
    if (!base) return path.startsWith("/") ? path : "/" + path;
    if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
    if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
    return base + path;
  } catch { return (base || "") + (path || ""); }
}

// Optional <meta name="csrf-token"> bridge
function readMeta() { try { return document.querySelector('meta[name="csrf-token"]')?.content || null; } catch { return null; } }
function writeMeta(token) {
  try {
    let meta = document.querySelector('meta[name="csrf-token"]');
    if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "csrf-token"); document.head.appendChild(meta); }
    meta.setAttribute("content", token || "");
  } catch {}
}

export function setCsrfToken(token) {
  _csrf = typeof token === "string" && token.length ? token : null;
  writeMeta(_csrf);
  return _csrf;
}
export function clearCsrfToken() { _csrf = null; writeMeta(""); }

// Sync getter: memory → cookie → meta
export function getCsrfToken() {
  return _csrf || readCookie(CSRF_COOKIE_NAME) || readMeta() || null;
}

// Ensure token exists (fetch once if missing). Never throws. Returns token or null.
export async function ensureCsrfToken() {
  const cached = getCsrfToken();
  if (cached) return cached;

  if (_pending) return _pending;

  const base = import.meta?.env?.VITE_API_BASE_URL || "";
  const url = joinUrl(base, "/api/auth/csrf");

  _pending = (async () => {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      // Try body
      let body = null;
      try { body = await res.clone().json(); } catch {}

      // Resolve token from multiple places
      const fromBody   = body?.token || body?.csrfToken || null;
      const fromHeader = res.headers.get(CSRF_HEADER_NAME);
      const fromCookie = readCookie(CSRF_COOKIE_NAME);

      const token = fromBody || fromHeader || fromCookie || null;
      if (token) setCsrfToken(token);
      return getCsrfToken();
    } catch {
      // Even on error, cookie might already be set by server; try cookie fallback.
      const fallback = readCookie(CSRF_COOKIE_NAME);
      if (fallback) setCsrfToken(fallback);
      return getCsrfToken();
    } finally {
      _pending = null;
    }
  })();

  return _pending;
}

export { CSRF_HEADER_NAME, CSRF_COOKIE_NAME };

export default {
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  getCsrfToken,
  ensureCsrfToken,
  setCsrfToken,
  clearCsrfToken,
};
