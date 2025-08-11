/**
 * Unified Secure API Client
 * - Compatible with your existing authFetch (keeps needsArm flow, base URL, Bearer header)
 * - Adds CSRF header, timeout, optional dedupe (JSON mode), normalized errors
 * - 429 exponential backoff + one network retry
 *
 * Place at: frontend/src/utils/apiClient.js
 *
 * Exports:
 *   - authFetch(path, options) -> Promise<Response>   // drop-in for your current code
 *   - apiFetch(urlOrPath, opts) -> Promise<any>       // JSON helper with dedupe + normalized errors
 *   - setOnNeedsArm(fn)                                // keeps your needsArm handler
 *   - setTokenGetter(fn)                               // avoid reading tokens from storage directly
 *   - setBaseUrl(url)                                  // override VITE_API_BASE_URL at runtime
 *   - setGlobal401Handler(fn)                          // generic 401 hook
 *   - setDefaultTimeout(ms)
 */

// ----- Global knobs -----
let onNeedsArmHandler = null;
let tokenGetter = () => {
  // Back-compat with your current implementation (you can replace this via setTokenGetter)
  try {
    return (
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("accessToken") ||
      null
    );
  } catch { return null; }
};
let runtimeBaseUrl = null;
let on401 = null;
let defaultTimeoutMs = 15000;

// ----- Public setters -----
export function setOnNeedsArm(fn) { onNeedsArmHandler = typeof fn === "function" ? fn : null; }
export function setTokenGetter(fn) { tokenGetter = typeof fn === "function" ? fn : tokenGetter; }
export function setBaseUrl(url) { runtimeBaseUrl = typeof url === "string" ? url : runtimeBaseUrl; }
export function setGlobal401Handler(fn) { on401 = typeof fn === "function" ? fn : null; }
export function setDefaultTimeout(ms) { defaultTimeoutMs = Math.max(1000, Number(ms) || 15000); }

// ----- CSRF helpers -----
function ensureMetaCsrfTag() {
  let meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "csrf-token");
    document.head.appendChild(meta);
  }
  return meta;
}
export function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta?.content) return meta.content;
  const m = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export function setCsrfToken(token) {
  const meta = ensureMetaCsrfTag();
  meta.setAttribute("content", token || "");
}

// ----- Utilities -----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(base) { return base + Math.floor(Math.random() * 150); }
function normalizeBody(body, headers) {
  if (!body) return null;
  if (typeof body === "string" || body instanceof FormData || body instanceof Blob) return body;
  if (headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams();
    for (const [k,v] of Object.entries(body)) params.append(k, String(v));
    return params;
  }
  headers.set("Content-Type", "application/json");
  return JSON.stringify(body);
}
async function parseResponseBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  const text = await res.text().catch(() => "");
  try { return JSON.parse(text); } catch { return { message: text }; }
}
function absoluteOrPrefixed(path) {
  try {
    // If path is already absolute, return as-is
    const u = new URL(path);
    return u.toString();
  } catch {
    const base = (runtimeBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "") || "";
    return `${base}${path}`;
  }
}

// ----- Core request with retries -----
async function doRequest(url, init, { retry429 = 3, retryNetwork = 1, needsArmEnabled = true } = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(init.timeoutMs || defaultTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const res = await (async () => {
    let attempts429 = 0;
    let networkAttempts = 0;
    while (true) {
      try {
        const r = await fetch(url, { ...init, signal: controller.signal });
        if (r.status === 429 && attempts429 < retry429) {
          const backoffs = [1000, 2000, 4000];
          const waitMs = (backoffs[attempts429] || 4000) + jitter(50);
          attempts429++;
          await sleep(waitMs);
          continue;
        }
        return r;
      } catch (err) {
        if (err?.name === "AbortError") throw err; // bubble up timeout
        if (networkAttempts < retryNetwork) {
          networkAttempts++;
          await sleep(1500);
          continue;
        }
        throw err;
      }
    }
  })().finally(() => clearTimeout(timeout));

  // Handle needsArm on 401 JSON bodies, keep original semantics
  if (res.status === 401 && needsArmEnabled) {
    let data = null;
    try { data = await res.clone().json(); } catch {}
    if (data?.needsArm && onNeedsArmHandler) {
      const originalInit = { ...init };
      const originalUrl = url;
      const retry = () => doRequest(originalUrl, originalInit, { retry429, retryNetwork, needsArmEnabled });
      try {
        onNeedsArmHandler({ walletId: data.walletId, path: originalUrl, options: originalInit, retry });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[apiClient] onNeedsArm handler error:", e);
      }
    } else if (on401) {
      try { on401(res); } catch {}
    }
  }

  return res;
}

// ----- Public API -----

/**
 * Drop-in replacement for your authFetch (returns Response).
 * - Adds CSRF header and sane defaults (cookies, cache, referrerPolicy)
 * - Preserves needsArm flow and Bearer Authorization from tokenGetter()
 */
export async function authFetch(path, options = {}) {
  const token = tokenGetter();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", headers.get("Accept") || "application/json");

  // Inject Authorization like your original (can remove once you migrate to cookie-only)
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const csrf = getCsrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf);

  const init = {
    credentials: "include",
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
    ...options,
    method: (options.method || "GET").toUpperCase(),
    headers,
  };
  init.body = normalizeBody(options.body, headers);

  const url = absoluteOrPrefixed(path);
  return doRequest(url, init, { retry429: 3, retryNetwork: 1, needsArmEnabled: true });
}

/**
 * JSON helper that parses the body and throws normalized errors.
 * - Optional request de-dupe for identical calls (default: true)
 */
const inflight = new Map(); // key -> Promise<any>
function keyFor(method, url, body) {
  const b = typeof body === "string" ? body : body ? JSON.stringify(body) : "";
  return `${method}:${url}:${b.length > 128 ? b.slice(0,128) : b}`;
}

export async function authFetch(urlOrPath, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();

  // Build init the same way as authFetch but we won't attach Authorization by default here
  const token = tokenGetter();
  const headers = new Headers(opts.headers || {});
  headers.set("Accept", headers.get("Accept") || "application/json");
  // Keep Authorization for back-compat if present or if you still rely on it:
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const csrf = getCsrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const init = {
    credentials: "include",
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
    ...opts,
    method,
    headers,
  };
  init.body = normalizeBody(opts.body, headers);

  const url = absoluteOrPrefixed(urlOrPath);

  const dedupe = opts.dedupe === false ? false : true;
  const k = dedupe ? keyFor(method, url, init.body) : undefined;

  const run = async () => {
    const res = await doRequest(url, init, { retry429: typeof opts.retry === "number" ? opts.retry : 2, retryNetwork: 1, needsArmEnabled: true });
    if (!res.ok) {
      const body = await parseResponseBody(res).catch(() => ({}));
      const err = new Error(body?.error || res.statusText || "request_failed");
      err.status = res.status || 0;
      throw err;
    }
    // Parse JSON (or text → JSON fallback)
    return parseResponseBody(res);
  };

  if (!k) return run();

  if (inflight.has(k)) return inflight.get(k);

  const p = run().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}