// src/hooks/useSingleLogsSocket.jsx
// Stable URL resolution + StrictMode-safe singleton + capped backoff.
// Also pushes messages to useLogsStore for StrategyConsoleSheet.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLogsStore } from "@/state/LogsStore";

/* ========= Safe origin helpers (no hard crash when window is missing) ========= */

function safeWindowOrigin() {
  try {
    if (typeof window !== "undefined" && window?.location?.origin) {
      return window.location.origin;
    }
  } catch {}
  // Dev default; harmless fallback if the real origin isn’t available yet.
  return "http://localhost:5173";
}

function httpOriginFromApiBase() {
  const apiBase = import.meta?.env?.VITE_API_BASE_URL;
  if (!apiBase) return safeWindowOrigin();
  try {
    const u = new URL(apiBase, safeWindowOrigin());
    return u.origin; // e.g., http://localhost:5001
  } catch {
    const m = String(apiBase).match(/^[a-z]+:\/\/[^/]+/i);
    return m ? m[0] : safeWindowOrigin();
  }
}

function toWsUrl(httpish) {
  try {
    const u = new URL(httpish, safeWindowOrigin());
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  } catch {
    const s = String(httpish || "");
    if (/^https?:\/\//i.test(s)) return s.replace(/^http/i, "ws");
    // As a last resort, turn the *current* page origin into ws(s)
    return toWsUrl(safeWindowOrigin());
  }
}

function joinPath(base, path) {
  return `${base}${path?.startsWith("/") ? path : `/${path || ""}`}`;
}

/**
 * Candidate WS URLs (highest → lowest)
 *  1) VITE_WS_BASE_URL (ws[s]:// exact)
 *  2) VITE_WS_BASE_URL (http[s]:// → ws[s]://)
 *  3) origin(VITE_API_BASE_URL) + (VITE_WS_PATH || /ws/logs)
 *  4) origin(VITE_API_BASE_URL) + /logs
 *  5) origin(VITE_API_BASE_URL) + /ws
 *  6) origin(VITE_API_BASE_URL)                  // root (legacy)
 *  7) origin(VITE_API_BASE_URL) + "/"            // explicit root
 */
function computeCandidateWsUrls() {
  const out = [];

  const explicit = import.meta?.env?.VITE_WS_BASE_URL;
  if (explicit) {
    try {
      const u = new URL(explicit, safeWindowOrigin());
      if (u.protocol.startsWith("ws")) return [u.toString()];
      if (u.protocol.startsWith("http")) return [toWsUrl(u.toString())];
    } catch {
      if (/^wss?:\/\//i.test(explicit)) return [explicit];
      if (/^https?:\/\//i.test(explicit)) return [toWsUrl(explicit)];
    }
  }

  const httpOrigin = httpOriginFromApiBase();
  const wsOrigin   = toWsUrl(httpOrigin);
  const path       = import.meta?.env?.VITE_WS_PATH || "/ws/logs";

  out.push(joinPath(wsOrigin, path));
  out.push(joinPath(wsOrigin, "/logs"));
  out.push(joinPath(wsOrigin, "/ws"));
  out.push(wsOrigin);
  out.push(joinPath(wsOrigin, "/"));

  // de-dup
  return Array.from(new Set(out));
}

/* ====================== Singleton + ownership ====================== */

let SOCKET = null;   // shared
let OWNER_ID = null; // hook instance that controls lifecycle
let OVERRIDE_URL = null;

// Dev helper: window.__SET_LOGS_WS__("ws://localhost:5001[/path]")
if (typeof window !== "undefined") {
  window.__SET_LOGS_WS__ = (url) => {
    try {
      const u = new URL(url, safeWindowOrigin());
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

const MAX_BACKOFF_MS = 15000;
const MAX_ATTEMPTS   = 10;

export default function useSingleLogsSocket(flags) {
  const instIdRef       = useRef(`owner-${Math.random().toString(36).slice(2)}`);
  const candidatesRef   = useRef([]);
  const candidateIdxRef = useRef(0);
  const attemptsRef     = useRef(0);
  const toastShownRef   = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const push = useLogsStore.getState().push;

    const debug = (...a) => {
      if (typeof window !== "undefined" && window.__LOGS_WS_DEBUG__) {
        // eslint-disable-next-line no-console
        console.debug("[logs-ws]", ...a);
      }
    };

    const candidates = () => {
      if (!candidatesRef.current.length) {
        try {
          candidatesRef.current = computeCandidateWsUrls();
        } catch (e) {
          debug("candidate compute failed:", e?.message);
          candidatesRef.current = ["ws://localhost:5001"];
        }
        candidateIdxRef.current = 0;
        debug("candidates:", candidatesRef.current);
      }
      return candidatesRef.current;
    };

    const currentUrl = () =>
      OVERRIDE_URL || candidates()[candidateIdxRef.current];

    const advanceCandidate = () => {
      const list = candidates();
      if (list.length > 1) {
        candidateIdxRef.current = (candidateIdxRef.current + 1) % list.length;
        debug("advance candidate ->", currentUrl());
      }
    };

    function forwardToStore(evData) {
      try {
        let data = evData;
        if (typeof data === "string") data = JSON.parse(data);
        if (typeof data === "string") data = JSON.parse(data); // nested JSON safe-guard

        const ts   = new Date().toLocaleTimeString([], { hour12: false });
        const line = (data?.line ?? "").toString();
        const raw  = (data?.line ?? data?.message ?? data?.text ?? "").toString();
         const text = `[${ts}] ${raw.trim()}`;

        // keep generic window event for new call-sites
        try { window.dispatchEvent(new CustomEvent("logs:message", { detail: evData })); } catch {}

        // back-compat for StrategyConsoleSheet (zustand)
        push({ ...data, text });
      } catch (e) {
        debug("message parse error", e?.message);
      }
    }

    function wire(sock) {
      sock.addEventListener("open", () => {
        debug("open ✅", currentUrl());
        attemptsRef.current = 0;
         try {
           const ts = new Date().toLocaleTimeString([], { hour12: false });
           useLogsStore.getState().push({
             botId: "__system__",
             level: "INFO",
             line: "logs socket connected",
             text: `[${ts}] [INFO] logs socket connected`,
           });
         } catch {}
      });

      sock.addEventListener("message", (ev) => {
        forwardToStore(ev.data);
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

      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n) + Math.random() * 500;
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

    // Ownership: only the first mounted instance controls lifecycle
    if (!OWNER_ID) {
      OWNER_ID = instIdRef.current;
      debug("claimed ownership");
    }

    if (OWNER_ID === instIdRef.current) {
      candidates();
      connect();

      const onUnload = () => {
        try { SOCKET?.close(1000, "unload"); } catch {}
        SOCKET = null;
        OWNER_ID = null;
      };
      window.addEventListener("beforeunload", onUnload);

      return () => {
        cancelled = true;
        window.removeEventListener("beforeunload", onUnload);
        // Don’t close the socket on React StrictMode unmount; just relinquish ownership.
        setTimeout(() => {
          if (OWNER_ID === instIdRef.current) OWNER_ID = null;
        }, 0);
      };
    } else {
      // Passive instance: do nothing
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags?.logs?.throttle]);

  return SOCKET;
}
