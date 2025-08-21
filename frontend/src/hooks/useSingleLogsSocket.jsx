/* eslint-disable no-console */
/**
 * useSingleLogsSocket.jsx — ultra-instrumented
 * -------------------------------------------------
 * What’s new in this diagnostic build:
 *  • TOP-LEVEL "file loaded" log so you can confirm bundling (after imports to keep ESM happy).
 *  • "Hook invoked ✅" log, and detector that warns if the hook is never invoked.
 *  • Clear candidate URL dump + chosen URL annotation (host/protocol/path/port).
 *  • Connection lifecycle logs (connect/open/close/error) with friendly close-code meaning.
 *  • Message pipeline logs: raw payload size/sample + nested-JSON attempt + parse-fail reason.
 *  • Reconnect scheduler logs: attempt #, backoff delay, rotating candidate index.
 *  • Ring buffer + window.dumpLogsSocket() for quick forensics.
 *  • Gentle hints when dialing the Vite dev server instead of the API server.
 *
 * To quickly inspect state:
 *    window.dumpLogsSocket()
 *    window.__SET_LOGS_WS__("ws://localhost:5001/ws/logs")
 *    window.__LOGS_WS_DEBUG__ = true
 *    localStorage.LOGS_WS_VERBOSE = "0"   // to silence info logs
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLogsStore } from "@/state/LogsStore";
import { triggerBuyAnimation } from "@/utils/tradeFlash";
const LOGS_SOCKET_DEBUG = false;

// ───────────────────────────────────────────────────────────────────────────
// TOP-LEVEL: confirm the file is bundled/loaded even if the hook is never called
// (Must be after imports; ESM requires imports first.)
// ───────────────────────────────────────────────────────────────────────────
if (LOGS_SOCKET_DEBUG) console.log("[env debug]", import.meta.env);
const __LOGS_WS_FILE_LOAD_TS__ = Date.now();
try {
  if (LOGS_SOCKET_DEBUG) console.log("[logs-ws] >>> useSingleLogsSocket.jsx file loaded @", new Date(__LOGS_WS_FILE_LOAD_TS__).toISOString());
} catch {}
if (typeof window !== "undefined") {
  // Track last time the hook was invoked. If never invoked within a few seconds of load,
  // we warn loudly to help you catch "not imported/not mounted" mistakes.
  window.__LOGS_WS_LAST_INVOKE_TS__ = window.__LOGS_WS_LAST_INVOKE_TS__ || null;

  // If the hook isn't invoked within 3s of file load, warn that it may not be mounted.
  setTimeout(() => {
    try {
      if (!window.__LOGS_WS_LAST_INVOKE_TS__) {
        console.warn("[logs-ws] Hook has NOT been invoked within 3s of file load. " +
          "It may not be imported or called. Ensure useSingleLogsSocket() runs (e.g., in App.jsx).");
      }
    } catch {}
  }, 3000);
}

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
  const wsOrigin = toWsUrl(httpOrigin);
  const path = import.meta?.env?.VITE_WS_PATH || "/ws/logs";

  out.push(joinPath(wsOrigin, path));
  out.push(joinPath(wsOrigin, "/logs"));
  out.push(joinPath(wsOrigin, "/ws"));
  out.push(wsOrigin);
  out.push(joinPath(wsOrigin, "/"));

  // de-dup
  return Array.from(new Set(out));
}

/* ====================== Singleton + ownership ====================== */

let SOCKET = null; // shared
let OWNER_ID = null; // hook instance that controls lifecycle
let OVERRIDE_URL = null;

// Dev helper: window.__SET_LOGS_WS__("ws://localhost:5001[/path]")
if (typeof window !== "undefined") {
  window.__SET_LOGS_WS__ = (url) => {
    try {
      const u = new URL(url, safeWindowOrigin());
      OVERRIDE_URL = u.toString();
      try {
        SOCKET?.close(1000, "override");
      } catch {}
      SOCKET = null;
      console.info("[logs-ws] override set ->", OVERRIDE_URL);
    } catch (e) {
      console.error("[logs-ws] invalid override:", url, e?.message);
    }
  };
  window.__LOGS_WS_DEBUG__ = window.__LOGS_WS_DEBUG__ ?? false;

  // Ring buffer for quick forensic dumps
  window.__LOGS_WS_TRACE__ = window.__LOGS_WS_TRACE__ || [];
  window.dumpLogsSocket = function dumpLogsSocket() {
    const snap = {
      ownerId: OWNER_ID,
      hasSocket: !!SOCKET,
      readyState: SOCKET?.readyState,
      override: OVERRIDE_URL || null,
      attempts: window.__LOGS_WS_ATTEMPTS__ || 0,
      lastUrl: window.__LOGS_WS_LAST_URL__ || null,
      candidateIdx: window.__LOGS_WS_CAND_IDX__ || 0,
      candidates: window.__LOGS_WS_CANDIDATES__ || [],
      env: {
        VITE_WS_BASE_URL: import.meta?.env?.VITE_WS_BASE_URL || null,
        VITE_API_BASE_URL: import.meta?.env?.VITE_API_BASE_URL || null,
        VITE_WS_PATH: import.meta?.env?.VITE_WS_PATH || null,
      },
      traceCount: window.__LOGS_WS_TRACE__.length,
      traceTail: window.__LOGS_WS_TRACE__.slice(-10),
    };
    if (LOGS_SOCKET_DEBUG) console.info("[logs-ws dump]", snap);
    return snap;
  };
}

const MAX_BACKOFF_MS = 15000;
const MAX_ATTEMPTS = 10;

function verboseOn() {
  try {
    const ls = typeof localStorage !== "undefined" ? localStorage.getItem("LOGS_WS_VERBOSE") : null;
    return ls !== "0"; // default ON
  } catch {
    return true;
  }
}

function tag(kind, data) {
  try {
    const arr = (typeof window !== "undefined" && window.__LOGS_WS_TRACE__) || null;
    if (arr) {
      const entry = { t: Date.now(), kind, ...data };
      arr.push(entry);
      if (arr.length > 300) arr.splice(0, arr.length - 300);
    }
  } catch {}
}

function meaningForCloseCode(code) {
  const map = {
    1000: "normal",
    1001: "going away",
    1002: "protocol error",
    1003: "unsupported data",
    1005: "no status",
    1006: "abnormal close (handshake drop)",
    1007: "invalid payload",
    1008: "policy violation (likely origin/CORS)",
    1009: "message too big",
    1010: "mandatory extension",
    1011: "internal error",
    1012: "service restart",
    1013: "try again later",
    1015: "TLS handshake failure",
  };
  return map[code] || "unknown";
}

export default function useSingleLogsSocket(flags) {
  // Log immediately that the hook function itself was entered
  try {
    if (LOGS_SOCKET_DEBUG) console.log("[logs-ws] hook invoked ✅", { time: new Date().toISOString() });
    if (typeof window !== "undefined") window.__LOGS_WS_LAST_INVOKE_TS__ = Date.now();
  } catch {}

  const instIdRef = useRef(`owner-${Math.random().toString(36).slice(2)}`);
  const candidatesRef = useRef([]);
  const candidateIdxRef = useRef(0);
  const attemptsRef = useRef(0);
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (LOGS_SOCKET_DEBUG) console.log("[logs-ws] useEffect mount for", instIdRef.current);

    let cancelled = false;
    const push = useLogsStore.getState().push;

    const debug = (...a) => { if (LOGS_SOCKET_DEBUG && typeof window !== "undefined" && (window.__LOGS_WS_DEBUG__ || verboseOn())) { console.debug("[logs-ws]", ...a); } };
    const info = (...a) => { if (LOGS_SOCKET_DEBUG && verboseOn()) console.info("[logs-ws]", ...a); };
    const warn = (...a) => { if (LOGS_SOCKET_DEBUG) console.warn("[logs-ws]", ...a); };
    const error = (...a) => { if (LOGS_SOCKET_DEBUG) console.error("[logs-ws]", ...a); };

    const showEnvOnce = (() => {
      let shown = false;
      return () => {
        if (shown) return;
        shown = true;
        info("env", {
          VITE_WS_BASE_URL: import.meta?.env?.VITE_WS_BASE_URL || null,
          VITE_API_BASE_URL: import.meta?.env?.VITE_API_BASE_URL || null,
          VITE_WS_PATH: import.meta?.env?.VITE_WS_PATH || "/ws/logs",
          pageOrigin: safeWindowOrigin(),
        });
      };
    })();

    const candidates = () => {
      if (!candidatesRef.current.length) {
        try {
          candidatesRef.current = computeCandidateWsUrls();
        } catch (e) {
          warn("candidate compute failed:", e?.message);
          candidatesRef.current = ["ws://localhost:5001"];
        }
        candidateIdxRef.current = 0;
        const list = candidatesRef.current;
        window.__LOGS_WS_CANDIDATES__ = list;
        info("candidates", list);
        tag("candidates", { list });
      }
      return candidatesRef.current;
    };

    const currentUrl = () => {
      const url = OVERRIDE_URL || candidates()[candidateIdxRef.current];
      window.__LOGS_WS_LAST_URL__ = url;
      window.__LOGS_WS_CAND_IDX__ = candidateIdxRef.current;
      return url;
    };

    function annotateUrl(url) {
      try {
        const u = new URL(url, safeWindowOrigin());
        return { host: u.host, protocol: u.protocol, path: u.pathname, port: u.port || (u.protocol === "wss:" ? "443" : "80") };
      } catch {
        return { note: "invalid url" };
      }
    }

    const advanceCandidate = () => {
      const list = candidates();
      if (list.length > 1) {
        candidateIdxRef.current = (candidateIdxRef.current + 1) % list.length;
        const url = currentUrl();
        const ann = annotateUrl(url);
        info("advance candidate ->", url, ann);
        tag("advance", { idx: candidateIdxRef.current, url, ann });
      }
    };

    function forwardToStore(evData) {
      try {
        let data = evData;
        if (typeof data === "string") {
          const size = data.length;
          const sample = data.slice(0, 200);
          debug("onmessage(raw)", { size, sample });
          try {
            data = JSON.parse(data);
          } catch (e1) {
            // Try nested JSON (stringified twice)
            try {
              data = JSON.parse(JSON.parse(evData));
              warn("message nested-JSON decoded");
            } catch (e2) {
              warn("JSON parse failed – backend may be sending plain text. Expecting { line: \"...\" }", { error: e1?.message });
              tag("parse_fail", { sample: sample });
              return; // Drop invalid payloads but log loudly
            }
          }
        }
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        const raw = (data?.line ?? data?.message ?? data?.text ?? "").toString();
        const text = `[${ts}] ${raw.trim()}`;

        // 🎆 Confetti trigger on buy success (minimal addition; keeps everything else unchanged)
        try {
          if (raw.includes("🎆")) {
            triggerBuyAnimation?.();
            // optional: broadcast to any listeners (UI can hook this if needed)
            try {
              window.dispatchEvent(new CustomEvent("logs:confetti", { detail: { raw } }));
            } catch {}
          }
        } catch {}

        try {
          window.dispatchEvent(new CustomEvent("logs:message", { detail: evData }));
        } catch {}

        push({ ...data, text });
      } catch (e) {
        error("message handler threw", e?.message || e);
      }
    }

    function wire(sock) {
      sock.addEventListener("open", () => {
        const url = currentUrl();
        const ann = annotateUrl(url);
        info("open ✅", url, ann);
        tag("open", { url, ann });
        attemptsRef.current = 0;
        try {
          const ts = new Date().toLocaleTimeString([], { hour12: false });
          useLogsStore.getState().push({
            botId: "__system__",
            level: "INFO",
            line: `logs socket connected → ${url}`,
            text: `[${ts}] [INFO] logs socket connected → ${url}`,
          });
        } catch {}
      });

      sock.addEventListener("message", (ev) => {
        forwardToStore(ev.data);
      });

      sock.addEventListener("close", (ev) => {
        const { code, reason } = ev || {};
        const meaning = meaningForCloseCode(code);
        warn("close", { code, meaning, reason: reason || "" });
        tag("close", { code, meaning, reason: reason || "" });
        SOCKET = null;

        // Rotate on common policy/handshake failures
        if (code === 1006 || code === 1008 || code === 1011 || code === 1015) {
          advanceCandidate();
        }
        if (!cancelled) scheduleReconnect();
      });

      sock.addEventListener("error", (err) => {
        error("error", err?.message || err);
        // Let 'close' drive reconnection
      });
    }

    function scheduleReconnect() {
      attemptsRef.current += 1;
      const n = attemptsRef.current;
      window.__LOGS_WS_ATTEMPTS__ = n;

      if (n >= MAX_ATTEMPTS) {
        if (!toastShownRef.current) {
          toastShownRef.current = true;
          toast("Logs connection failed repeatedly. Pausing retries.", { duration: 5000 });
        }
        warn("max attempts reached; giving up");
        tag("giveup", { attempts: n });
        return;
      }

      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n) + Math.random() * 500;
      info(`reconnect #${n} in ~${Math.round(delay / 1000)}s → ${currentUrl()}`);
      tag("reconnect", { n, delay: Math.round(delay) });
      setTimeout(() => {
        if (!cancelled && OWNER_ID === instIdRef.current && !SOCKET) {
          connect();
        }
      }, delay);
    }

    function connect() {
      if (SOCKET) return; // already connected/connecting

      showEnvOnce();
      const url = currentUrl();
      const ann = annotateUrl(url);
      info("connecting →", url, ann);

      // Common pitfall hint
      if (/^ws:\/\/localhost:5173/.test(url)) {
        warn(
          "You're dialing the Vite dev server (5173), not the backend (5001). Check VITE_API_BASE_URL / VITE_WS_BASE_URL."
        );
      }
      if (!/\/ws\/logs|\/logs|\/ws|\/$/.test(ann.path || "")) {
        warn(
          "URL path doesn't look like a logs endpoint. If your server mounts '/ws/logs', set VITE_WS_BASE_URL or VITE_WS_PATH."
        );
      }

      try {
        SOCKET = new WebSocket(url);
      } catch (e) {
        error("ctor error", e?.message || e);
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
      info("claimed ownership:", OWNER_ID);
    }

    if (OWNER_ID === instIdRef.current) {
      candidates();
      connect();

      const onUnload = () => {
        try {
          SOCKET?.close(1000, "unload");
        } catch {}
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
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags?.logs?.throttle]);

  return SOCKET;
}