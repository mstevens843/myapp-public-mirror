/**
 * frontend/src/utils/authFetch.js
 * ------------------------------------------------------------------
 * - Cookie-only by default (no Authorization header unless opted in)
 * - BASE + path resolution (no new URL surprises)
 * - credentials:'include', JSON CT normalization
 * - 419 CSRF bootstrap + retry once
 * - 401 auto-refresh then retry once
 * - 401 {needsArm:true} → onNeedsArm handler (with fallback toast)
 * - 429 backoff + one network retry
 * - 304 (GET) → auto-retry once with cache-busting ts param
 * - Options: { retry, retryNetwork, needsArmEnabled, timeoutMs }
 * - Debug: window.__AUTHFETCH_DEBUG__ = true (or setAuthFetchDebug(true))
 */

import { toast } from "sonner";

// ----- Global knobs -----
let onNeedsArmHandler = null;
// Cookie-only by default. Opt-in to Bearer with setTokenGetter(fn) if you truly need it.
let tokenGetter = () => null;

let runtimeBaseUrl = null;
let on401 = null;
let defaultTimeoutMs = 15000;

// Debug toggle
let DEBUG = typeof window !== "undefined" && !!window.__AUTHFETCH_DEBUG__;
export function setAuthFetchDebug(v) {
  DEBUG = !!v;
  try { window.__AUTHFETCH_DEBUG__ = DEBUG; } catch {}
}

// ----- Public setters -----
/**
 * Register a handler for 401 JSON body { needsArm:true, walletId }
 * Handler receives: { walletId, path, options, retry }
 */
export function setOnNeedsArm(handler) {
  onNeedsArmHandler = typeof handler === "function" ? handler : null;
}
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
function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
export function getCsrfToken() {
  // Support common names and server __Host- cookies
  const names = ["__Host-csrf", "csrf_token", "csrf", "XSRF-TOKEN", "xsrfToken", "csrfToken"];
  for (const n of names) {
    const v = getCookie(n);
    if (v) return v;
  }
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta?.content || null;
}
export function setCsrfToken(token) {
  const meta = ensureMetaCsrfTag();
  meta.setAttribute("content", token || "");
}
async function bootstrapCsrf(baseUrlOrigin) {
  try {
    const res = await fetch(joinUrl(baseUrlOrigin, "/api/auth/csrf"), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (data?.csrfToken) setCsrfToken(data.csrfToken);
    return res.ok;
  } catch {
    return false;
  }
}

// ----- Utilities -----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(base) { return base + Math.floor(Math.random() * 150); }

function normalizeBody(body, headers) {
  if (body == null) return null;

  // If caller passed a string, still ensure JSON header
  if (typeof body === "string") {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return body;
  }

  if (body instanceof FormData || body instanceof Blob) return body;

  if (headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) params.append(k, String(v));
    return params;
  }

  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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

// ----- BASE + path resolver -----
function baseString() {
  // If env is undefined, return "" so requests are relative to current origin (Vite proxy etc.)
  const envBase = import.meta.env.VITE_API_BASE_URL || "";
  return (runtimeBaseUrl ?? envBase) || "";
}
function joinUrl(base, path) {
  if (!base) return path; // same-origin (use dev proxy)
  return `${base.replace(/\/+$/, "")}${path}`;
}
function resolveUrl(path) {
  // Absolute http(s) passed in? Use as-is.
  if (/^https?:\/\//i.test(path)) return path;
  // Otherwise stick to BASE + path (or same-origin when BASE is "")
  return joinUrl(baseString(), path);
}

async function refreshSession(baseUrlOrigin) {
  try {
    const url = joinUrl(baseUrlOrigin, "/api/auth/refresh");
    if (DEBUG) console.debug("[authFetch] POST refresh →", url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (DEBUG) console.debug("[authFetch] refresh status:", res.status);
    return res.ok;
  } catch (e) {
    if (DEBUG) console.error("[authFetch] refresh failed:", e?.message || e);
    return false;
  }
}

// ----- Core request with retries + 401 refresh + 419 CSRF + 429 backoff -----
async function doRequest(originalUrl, init, {
  retry429 = 3,
  retryNetwork = 1,
  needsArmEnabled = true,
} = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(init.timeoutMs || defaultTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const baseForRefresh = baseString(); // use configured/same-origin base

  let attempts429 = 0;
  let networkAttempts = 0;
  let triedRefresh = false;
  let triedCsrf = false;
  let triedCacheBust304 = false;
  let currentUrl = originalUrl;

  while (true) {
    try {
      if (DEBUG) {
        const safeHeaders = {};
        new Headers(init.headers || {}).forEach((v, k) => safeHeaders[k] = k.toLowerCase() === "authorization" ? "[redacted]" : v);
        console.debug("[authFetch] →", init.method, currentUrl, {
          headers: safeHeaders, hasBody: !!init.body,
          retry429Left: retry429 - attempts429, retryNetworkLeft: retryNetwork - networkAttempts, timeoutMs,
        });
      }

      const res = await fetch(currentUrl, { ...init, signal: controller.signal });
      if (DEBUG) console.debug("[authFetch] ←", init.method, currentUrl, res.status);

      // 304 on GET: retry once with cache-busting ts param to force a fresh body
      if (res.status === 304 && init.method === "GET" && !triedCacheBust304) {
        triedCacheBust304 = true;
        const sep = currentUrl.includes("?") ? "&" : "?";
        currentUrl = `${currentUrl}${sep}ts=${Date.now()}`;
        if (DEBUG) console.debug("[authFetch] 304 → retrying with cache-bust:", currentUrl);
        continue;
      }

      // 401 → needsArm OR refresh-once
      if (res.status === 401) {
        let body = null;
        try { body = await res.clone().json(); } catch {}
        if (DEBUG) console.debug("[authFetch] 401 body:", body);

        // needsArm flow
        if (needsArmEnabled && body?.needsArm) {
          const retry = () => doRequest(currentUrl, init, { retry429, retryNetwork, needsArmEnabled });
          if (onNeedsArmHandler) {
            try {
              onNeedsArmHandler({ walletId: body.walletId, path: currentUrl, options: init, retry });
            } catch (e) {
              console.error("[authFetch] onNeedsArm handler error:", e);
            }
          } else {
            try {
              toast.error("Protected Mode is enabled. Please arm your automation in Account settings before trading.");
            } catch {}
          }
          clearTimeout(timeout);
          return res; // let caller decide next UI action
        }

        // Try one refresh → then retry original once
        if (!triedRefresh) {
          triedRefresh = true;
          const ok = await refreshSession(baseForRefresh);
          if (ok) {
            // CSRF might rotate
            const headers = new Headers(init.headers || {});
            const csrf = getCsrfToken();
            if (csrf && !headers.has("X-CSRF-Token") && init.method && !["GET","HEAD","OPTIONS"].includes(init.method)) {
              headers.set("X-CSRF-Token", csrf);
              init = { ...init, headers };
            }
            if (DEBUG) console.debug("[authFetch] retrying after refresh:", init.method, currentUrl);
            continue;
          }
          if (on401) { try { on401(res); } catch {} }
        }
      }

      // 419 → CSRF missing/invalid → bootstrap once then retry
      if (res.status === 419 && !triedCsrf) {
        triedCsrf = await bootstrapCsrf(baseForRefresh);
        if (triedCsrf) {
          // ensure header is present for non-GET after bootstrap
          const headers = new Headers(init.headers || {});
          const csrf = getCsrfToken();
          if (csrf && !["GET","HEAD","OPTIONS"].includes(init.method)) {
            headers.set("X-CSRF-Token", csrf);
            init = { ...init, headers };
          }
          if (DEBUG) console.debug("[authFetch] retried after CSRF bootstrap");
          continue;
        }
      }

      // 429 backoff
      if (res.status === 429 && attempts429 < retry429) {
        const backoffs = [1000, 2000, 4000];
        const waitMs = (backoffs[attempts429] || 4000) + jitter(50);
        attempts429++;
        try { toast.info("Rate limited; retrying…"); } catch {}
        if (DEBUG) console.warn("[authFetch] 429, backing off", waitMs, "ms");
        await sleep(waitMs);
        continue;
      }

      clearTimeout(timeout);
      return res;
    } catch (err) {
      if (err?.name === "AbortError") {
        clearTimeout(timeout);
        if (DEBUG) console.error("[authFetch] timeout/abort:", currentUrl, timeoutMs, "ms");
        throw err;
      }
      if (networkAttempts < retryNetwork) {
        networkAttempts++;
        try {
          toast.error("Network error; retrying…", {
            action: {
              label: "Retry now",
              onClick: () => {
                doRequest(currentUrl, init, { retry429, retryNetwork, needsArmEnabled }).catch(() => {});
              },
            },
          });
        } catch {}
        if (DEBUG) console.warn("[authFetch] network error, retrying:", err?.message || err);
        await sleep(1500);
        continue;
      }
      clearTimeout(timeout);
      if (DEBUG) console.error("[authFetch] network error (final):", currentUrl, err?.message || err);
      throw new Error(err?.message || "Network error while contacting backend");
    }
  }
}

// ----- Public API -----

/**
 * authFetch(path, options) -> Response
 * - Cookie auth with credentials: 'include'
 * - Adds Content-Type + Accept when appropriate
 * - Adds X-CSRF-Token if present (non-blocking if missing)
 * - Keeps Bearer via tokenGetter() (disable by default here)
 * - Adds Cache-Control: no-cache on GET
 * - Supports options.retry (number) to control 429 backoff attempts
 */
export async function authFetch(path, options = {}) {
  const token = tokenGetter();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  // Determine method early for header decisions
  const method = (options.method || "GET").toUpperCase();

  // Optional Authorization (opt-in via setTokenGetter)
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // CSRF for unsafe methods
  const csrf = getCsrfToken();
  if (csrf && !["GET","HEAD","OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrf);
  }

  // Encourage revalidation on GET (belt & suspenders vs proxy caching)
  if (method === "GET" && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-cache");
  }

  const init = {
    credentials: "include",
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
    ...options,
    method,
    headers,
  };
  init.body = normalizeBody(options.body, headers);

  const url = resolveUrl(path);
  if (DEBUG) {
    console.info("[authFetch] BASE:", baseString() || "(same-origin)");
    console.info("[authFetch] REQUEST:", init.method, url);
  }

  return doRequest(
    url,
    init,
    {
      retry429: typeof options.retry === "number" ? options.retry : 3,
      retryNetwork: typeof options.retryNetwork === "number" ? options.retryNetwork : 1,
      needsArmEnabled: options.needsArmEnabled !== undefined ? !!options.needsArmEnabled : true,
    }
  );
}

/**
 * apiFetch(urlOrPath, opts) -> parsed JSON (throws on !ok)
 * - Same defaults as authFetch
 * - Dedupe identical in-flight requests by default
 */
const inflight = new Map(); // key -> Promise<any>
function keyFor(method, url, body) {
  const b = typeof body === "string" ? body : body ? JSON.stringify(body) : "";
  return `${method}:${url}:${b.length > 128 ? b.slice(0,128) : b}`;
}

export async function apiFetch(urlOrPath, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();

  const token = tokenGetter();
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const csrf = getCsrfToken();
  if (csrf && !["GET","HEAD","OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrf);
  }

  const init = {
    credentials: "include",
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
    ...opts,
    method,
    headers,
  };
  init.body = normalizeBody(opts.body, headers);

  const url = resolveUrl(urlOrPath);
  const dedupe = opts.dedupe === false ? false : true;
  const k = dedupe ? keyFor(method, url, init.body) : undefined;

  const run = async () => {
    const res = await doRequest(url, init, {
      retry429: typeof opts.retry === "number" ? opts.retry : 2,
      retryNetwork: 1,
      needsArmEnabled: true
    });
    if (!res.ok) {
      const body = await parseResponseBody(res).catch(() => ({}));
      const err = new Error(body?.error || res.statusText || "request_failed");
      err.status = res.status || 0;
      throw err;
    }
    return parseResponseBody(res);
  };

  if (!k) return run();
  if (inflight.has(k)) return inflight.get(k);
  const p = run().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export default authFetch;
