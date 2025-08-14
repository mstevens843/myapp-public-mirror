// src/hooks/useSingleLogsSocket.jsx
// Stable URL resolution (uses VITE_WS_BASE_URL or VITE_API_BASE_URL origin + VITE_WS_PATH),
// StrictMode-proof singleton ownership (no premature close on cleanup),
// exponential backoff with cap, rotate candidates on policy-ish close codes,
// single toast after max attempts, runtime override via window.__SET_LOGS_WS__(url)

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/* ====================== URL resolution helpers ====================== */

function getOriginFromApiBase() {
  const apiBase = import.meta?.env?.VITE_API_BASE_URL;
  if (apiBase) {
    try {
      const u = new URL(apiBase, window.location.origin);
      return u.origin; // e.g., http://localhost:5001
    } catch {
      const m = String(apiBase).match(/^[a-z]+:\/\/[^/]+/i);
      if (m) return m[0];
    }
  }
  return window.location.origin; // fallback: vite origin (http://localhost:5173) if nothing else
}

function toWsUrl(httpish) {
  try {
    const u = new URL(httpish, window.location.origin);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  } catch {
    return String(httpish).replace(/^http/i, "ws");
  }
}

function joinPath(base, path) {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Compute prioritized candidate WS URLs.
 * Priority:
 *  1) VITE_WS_BASE_URL if full ws(s)://
 *  2) VITE_WS_BASE_URL if http(s):// (convert to ws(s)://)
 *  3) origin(VITE_API_BASE_URL) + VITE_WS_PATH (default /ws/logs)
 *  4) origin(VITE_API_BASE_URL) + "/logs"
 *  5) origin(VITE_API_BASE_URL) + "/ws"
 */
function computeCandidateWsUrls() {
  const out = [];

  const explicit = import.meta?.env?.VITE_WS_BASE_URL;
  if (explicit) {
    try {
      const u = new URL(explicit, window.location.origin);
      if (u.protocol.startsWith("ws")) return [u.toString()];
      if (u.protocol.startsWith("http")) return [toWsUrl(u.toString())];
    } catch {
      if (/^ws(s)?:\/\//i.test(explicit)) return [explicit];
      if (/^http(s)?:\/\//i.test(explicit)) return [toWsUrl(explicit)];
    }
  }

  const httpOrigin = getOriginFromApiBase(); // prefer backend (e.g., http://localhost:5001)
  const wsOrigin = toWsUrl(httpOrigin);
  const path = import.meta?.env?.VITE_WS_PATH || "/ws/logs";

  out.push(joinPath(wsOrigin, path));
  out.push(joinPath(wsOrigin, "/logs"));
  out.push(joinPath(wsOrigin, "/ws"));

  return out;
}

/* ====================== Singleton + ownership ====================== */

let SOCKET = null;           // shared singleton
let OWNER_ID = null;         // which hook instance controls lifecycle
let OVERRIDE_URL = null;     // runtime override

// Handy runtime override in dev:
//   window.__SET_LOGS_WS__("ws://localhost:5001/ws/logs")
if (typeof window !== "undefined") {
  window.__SET_LOGS_WS__ = (url) => {
    try {
      const u = new URL(url, window.location.origin);
      OVERRIDE_URL = u.toString();
      try { SOCKET?.close(1000, "override"); } catch {}
      SOCKET = null;
      console.info("[logs-ws] override set ->", OVERRIDE_URL);
    } catch (e) {
      console.error("[logs-ws] invalid override:", url, e?.message);
    }
  };
  window.__LOGS_WS_DEBUG__ = window.__LOGS_WS_DEBUG__ ?? false;
}

/* ====================== Hook ====================== */

const MAX_BACKOFF_MS = 15000;
const MAX_ATTEMPTS = 10;

export default function useSingleLogsSocket(flags) {
  const instIdRef = useRef(`owner-${Math.random().toString(36).slice(2)}`);
  const candidatesRef = useRef([]);
  const candidateIdxRef = useRef(0);
  const attemptsRef = useRef(0);
  const toastShownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const debug = (...a) => {
      if (window.__LOGS_WS_DEBUG__) console.debug("[logs-ws]", ...a);
    };

    const candidates = () => {
      if (!candidatesRef.current.length) {
        candidatesRef.current = computeCandidateWsUrls();
        candidateIdxRef.current = 0;
        debug("candidates:", candidatesRef.current);
      }
      return candidatesRef.current;
    };

    const currentUrl = () => OVERRIDE_URL || candidates()[candidateIdxRef.current];

    const advanceCandidate = () => {
      const list = candidates();
      if (list.length > 1) {
        candidateIdxRef.current = (candidateIdxRef.current + 1) % list.length;
        debug("advance candidate ->", currentUrl());
      }
    };

    function wire(sock) {
      sock.addEventListener("open", () => {
        debug("open ✅", currentUrl());
        attemptsRef.current = 0;
      });

      sock.addEventListener("message", (ev) => {
        // Keep the hook generic: bubble to app-level listeners.
        try {
          window.dispatchEvent(new CustomEvent("logs:message", { detail: ev.data }));
        } catch {}
      });

      sock.addEventListener("close", (ev) => {
        const { code, reason } = ev || {};
        debug("close", code, reason || "");
        SOCKET = null;

        // Rotate on common policy/handshake failures
        if (code === 1006 || code === 1008 || code === 1011 || code === 1015) {
          advanceCandidate();
        }
        if (!cancelled) scheduleReconnect();
      });

      sock.addEventListener("error", (err) => {
        debug("error", err?.message || err);
        // Let 'close' drive reconnection
      });
    }

    function scheduleReconnect() {
      attemptsRef.current += 1;
      const n = attemptsRef.current;

      if (n >= MAX_ATTEMPTS) {
        if (!toastShownRef.current) {
          toastShownRef.current = true;
          toast("Logs connection failed repeatedly. Pausing retries.", { duration: 5000 });
        }
        debug("max attempts reached; giving up");
        return;
      }

      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n) + (Math.random() * 500);
      debug(`reconnect #${n} in ~${Math.round(delay / 1000)}s → ${currentUrl()}`);
      setTimeout(() => {
        if (!cancelled && OWNER_ID === instIdRef.current && !SOCKET) {
          connect();
        }
      }, delay);
    }

    function connect() {
      if (SOCKET) return; // already connected/connecting

      const url = currentUrl();
      debug("connecting →", url);
      try {
        SOCKET = new WebSocket(url);
      } catch (e) {
        debug("ctor error", e?.message || e);
        SOCKET = null;
        advanceCandidate();
        scheduleReconnect();
        return;
      }
      wire(SOCKET);
    }

    // ----- Ownership: only the first mounted instance controls lifecycle -----
    if (!OWNER_ID) {
      OWNER_ID = instIdRef.current;
      debug("claimed ownership");
    }

    if (OWNER_ID === instIdRef.current) {
      // Only the owner resolves candidates and connects
      candidates();
      connect();

      // Close on full page unload (not on React StrictMode cleanup)
      const onUnload = () => {
        try { SOCKET?.close(1000, "unload"); } catch {}
        SOCKET = null;
        OWNER_ID = null;
      };
      window.addEventListener("beforeunload", onUnload);

      return () => {
        cancelled = true;
        window.removeEventListener("beforeunload", onUnload);
        // Do NOT close socket here (prevents "closed before established" in dev)
        // Just release ownership so the next mount can take over.
        setTimeout(() => {
          if (OWNER_ID === instIdRef.current) OWNER_ID = null;
        }, 0);
      };
    } else {
      // Passive instance
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags?.logs?.throttle]);

  return SOCKET;
}
