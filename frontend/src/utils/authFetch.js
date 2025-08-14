// src/utils/authFetch.js
// What changed (minimal, targeted):
// - Proactively ensure CSRF before any NON-GET request (once).
// - Handle CSRF failure as 403 OR 419 (your backend uses 403), then bootstrap once and retry.
// - After 401 refresh success, re-ensure CSRF (it may rotate) before replay.
// - Everything else (exports, return type = Response, body/headers, 429/network handling)
//   remains exactly as before to avoid breaking other flows.

import { toast } from "sonner";

// ----- Global knobs -----
let onNeedsArmHandler = null;
let tokenGetter = () => null;

let runtimeBaseUrl = null;
let on401 = null;
let defaultTimeoutMs = 15000;

let DEBUG = typeof window !== "undefined" && !!window.__AUTHFETCH_DEBUG__;
export function setAuthFetchDebug(v) {
  DEBUG = !!v;
  try { window.__AUTHFETCH_DEBUG__ = DEBUG; } catch {}
}

// ----- Public setters -----
export function setOnNeedsArm(handler) {
  onNeedsArmHandler = typeof handler === "function" ? handler : null;
}
export function setTokenGetter(fn) { tokenGetter = typeof fn === "function" ? fn : tokenGetter; }
export function setBaseUrl(url) { runtimeBaseUrl = typeof url === "string" ? url : runtimeBaseUrl; }
export function setGlobal401Handler(fn) { on401 = typeof fn === "function" ? fn : null; }
export function setDefaultTimeout(ms) { defaultTimeoutMs = Math.max(1000, Number(ms) || 15000); }

// ----- CSRF helpers (unchanged behavior + a small ensure wrapper) -----
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

// NEW: ensure once by calling /api/auth/csrf (accepts { token } or { csrfToken })
let _ensuringCsrf = null;
async function ensureCsrfOnce(baseUrlOrigin) {
  const existing = getCsrfToken();
  if (existing) return existing;
  if (_ensuringCsrf) return _ensuringCsrf;

  const url = joinUrl(baseUrlOrigin, "/api/auth/csrf");
  _ensuringCsrf = (async () => {
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      const token = data?.token || data?.csrfToken || getCsrfToken();
      if (token) setCsrfToken(token);
      return token || null;
    } catch {
      return null;
    } finally {
      _ensuringCsrf = null;
    }
  })();

  return _ensuringCsrf;
}

// ----- Utilities -----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(base) { return base + Math.random() * 150 | 0; }
const isUnsafe = (m) => !["GET","HEAD","OPTIONS"].includes((m || "GET").toUpperCase());

function normalizeBody(body, headers) {
  if (body == null) return null;

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
  const envBase = import.meta.env.VITE_API_BASE_URL || "";
  return (runtimeBaseUrl ?? envBase) || "";
}
function joinUrl(base, path) {
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
}
function resolveUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
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

// ----- Core request with retries + 401 refresh + CSRF bootstrap (403/419) + 429 backoff -----
async function doRequest(originalUrl, init, {
  retry429 = 3,
  retryNetwork = 1,
  needsArmEnabled = true,
} = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(init.timeoutMs || defaultTimeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const baseForRefresh = baseString();

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

      // 304 on GET: retry once with cache-busting ts param
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
            try { toast.error("Protected Mode is enabled. Please arm your automation in Account settings before trading."); } catch {}
          }
          clearTimeout(timeout);
          return res;
        }

        // Try one refresh → then retry original once
        if (!triedRefresh) {
          triedRefresh = true;
          const ok = await refreshSession(baseForRefresh);
          if (ok) {
            // CSRF may rotate after refresh → ensure again for unsafe methods
            if (isUnsafe(init.method)) {
              const token = getCsrfToken() || await ensureCsrfOnce(baseForRefresh);
              if (token) {
                const headers = new Headers(init.headers || {});
                headers.set("X-CSRF-Token", token);
                init = { ...init, headers };
              }
            }
            if (DEBUG) console.debug("[authFetch] retrying after refresh:", init.method, currentUrl);
            continue;
          }
          if (on401) { try { on401(res); } catch {} }
        }
      }

      // CSRF failure → your backend uses 403 (some use 419). Support both.
      if ((res.status === 403 || res.status === 419) && !triedCsrf && isUnsafe(init.method)) {
        triedCsrf = true;
        const token = await ensureCsrfOnce(baseForRefresh);
        if (token) {
          const headers = new Headers(init.headers || {});
          headers.set("X-CSRF-Token", token);
          init = { ...init, headers };
          if (DEBUG) console.debug("[authFetch] retried after CSRF bootstrap");
          continue;
        }
      }

      // 429 backoff (bounded)
      if (res.status === 429 && attempts429 < retry429) {
        const backoffs = [10000, 20000, 40000];
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
        await sleep(10000);
        continue;
      }
      clearTimeout(timeout);
      if (DEBUG) console.error("[authFetch] network error (final):", currentUrl, err?.message || err);
      throw new Error(err?.message || "Network error while contacting backend");
    }
  }
}

// ----- Public API -----
export async function authFetch(path, options = {}) {
  const token = tokenGetter();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const method = (options.method || "GET").toUpperCase();

  // Optional Authorization
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // **NEW** Proactively ensure CSRF for unsafe methods before first attempt
  if (isUnsafe(method)) {
    const base = baseString();
    const existing = getCsrfToken();
    if (!existing) {
      await ensureCsrfOnce(base);
    }
    const tok = getCsrfToken();
    if (tok) headers.set("X-CSRF-Token", tok);
  }

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

  // Ensure CSRF for unsafe apiFetch as well
  if (isUnsafe(method)) {
    const base = baseString();
    const existing = getCsrfToken();
    if (!existing) await ensureCsrfOnce(base);
    const tok = getCsrfToken();
    if (tok) headers.set("X-CSRF-Token", tok);
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
