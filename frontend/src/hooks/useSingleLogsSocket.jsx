/**
 * useSingleLogsSocket.jsx
 * ------------------------------------------------------------------
 * What changed
 *  - StrictMode-proof singleton: one owner manages the socket; cleanup
 *    during dev remounts does NOT close the connection.
 *  - Removed idle "stale" reaper so an otherwise healthy, quiet socket
 *    isn't closed every 30s (which caused 1006 churn).
 *  - Kept robust WS URL resolution + diagnostics and exponential backoff.
 *  - Uses addEventListener to avoid handler clobbering across mounts.
 *  - Runtime override: window.__SET_LOGS_WS__(url) to force a URL.
 *
 * Why
 *  - React 18 StrictMode mounts, unmounts, remounts effects in dev.
 *    Tearing the socket down in cleanup yields “closed before established”
 *    and repeated 1006 codes even when the server accepted the upgrade.
 *
 * Risk addressed
 *  - Spurious WS closes in dev and churn when logs are idle.
 * ------------------------------------------------------------------ */

import { useEffect, useRef } from "react";
import { useLogsStore } from "@/state/LogsStore";
import { toast } from "react-toastify";
import { triggerBuyAnimation } from "@/utils/tradeFlash";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

/* --------------------------- URL resolution --------------------------- */

function getOriginFromApiBase() {
  const apiBase = import.meta.env.VITE_API_BASE_URL;
  // If API base is provided, take its origin; else use current origin.
  if (apiBase) {
    try {
      const url = new URL(apiBase, window.location.origin);
      return url.origin; // e.g. http://localhost:5001
    } catch {
      // If apiBase was something like "http://localhost:5001/api"
      // and URL() failed due to bad input, fall back to string parsing.
      try {
        const m = apiBase.match(/^[a-z]+:\/\/[^/]+/i);
        if (m) return m[0];
      } catch {}
    }
  }
  return window.location.origin; // e.g. http://localhost:5173 (vite)
}

const toWsUrl = (httpishUrl) => httpishUrl.replace(/^http/i, "ws");
const joinPath = (base, path) => `${base}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Compute an ordered list of candidate WebSocket URLs to try.
 * Priority:
 *  1) VITE_WS_BASE_URL if it looks like a full ws(s):// URL
 *  2) VITE_WS_BASE_URL if it’s http(s):// (convert to ws(s)://)
 *  3) Origin-from-API + VITE_WS_PATH (default "/ws/logs")
 *  4) Origin-from-API + "/logs"
 *  5) Origin-from-API + "/ws"
 */
function computeCandidateWsUrls() {
  const candidates = [];

  const explicit = import.meta.env.VITE_WS_BASE_URL;
  if (explicit) {
    try {
      const u = new URL(explicit, window.location.origin);
      if (u.protocol.startsWith("ws")) {
        candidates.push(u.toString());
        return candidates;
      }
      if (u.protocol.startsWith("http")) {
        candidates.push(toWsUrl(u.toString()));
        return candidates;
      }
    } catch {
      // If explicit is a bare string that URL() can’t parse, try basic replace
      if (/^ws(s)?:\/\//i.test(explicit)) {
        candidates.push(explicit);
        return candidates;
      }
      if (/^http(s)?:\/\//i.test(explicit)) {
        candidates.push(toWsUrl(explicit));
        return candidates;
      }
    }
  }

  const origin = getOriginFromApiBase(); // http(s)://host[:port]
  const wsOrigin = toWsUrl(origin);      // ws(s)://host[:port]
  const path = import.meta.env.VITE_WS_PATH || "/ws/logs";

  candidates.push(joinPath(wsOrigin, path)); // primary
  candidates.push(joinPath(wsOrigin, "/logs"));
  candidates.push(joinPath(wsOrigin, "/ws"));

  return candidates;
}

/* ----------------------- Singleton & StrictMode guard ----------------------- */

// Global singleton socket shared across all hook instances
let socket = null;
// Which hook instance “owns” lifecycle decisions
let socketOwnerId = null;
// Optional runtime URL override
let overrideUrl = null;

// Expose a debug hook to override the WS URL at runtime (for quick testing)
// Usage in console: window.__SET_LOGS_WS__("ws://localhost:5001/ws/logs")
if (typeof window !== "undefined") {
  window.__SET_LOGS_WS__ = (url) => {
    try {
      const u = new URL(url, window.location.origin);
      overrideUrl = u.toString();
      if (socket) {
        try { socket.close(); } catch {}
        socket = null;
      }
      console.info("[logs-ws] runtime override set ->", overrideUrl);
    } catch (e) {
      console.error("[logs-ws] invalid override URL:", url, e?.message);
    }
  };
  // Optional extra client-side debugging
  window.__LOGS_WS_DEBUG__ = window.__LOGS_WS_DEBUG__ ?? false;
}

export default function useSingleLogsSocket() {
  const push = useLogsStore((s) => s.push);
  const { flags } = useFeatureFlags();

  // Per-instance refs
  const myOwnerIdRef = useRef(`owner-${Math.random().toString(36).slice(2)}`);
  const candidatesRef = useRef([]);
  const candidateIndexRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const lastProcessedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const debug = (...args) => {
      if (typeof window !== "undefined" && window.__LOGS_WS_DEBUG__) {
        console.debug("[logs-ws]", ...args);
      }
    };

    const currentUrl = () => {
      if (overrideUrl) return overrideUrl;
      const list = candidatesRef.current;
      const i = Math.min(candidateIndexRef.current, list.length - 1);
      return list[i];
    };

    const advanceCandidate = () => {
      const list = candidatesRef.current;
      if (list.length <= 1) return;
      candidateIndexRef.current = (candidateIndexRef.current + 1) % list.length;
      debug("advance candidate ->", currentUrl());
    };

    function handleMessage(e) {
      // Optional throttle
      if (flags?.logs?.throttle) {
        const now = Date.now();
        if (now - lastProcessedRef.current < 10) return; // ~100/s
        lastProcessedRef.current = now;
      }

      try {
        let data = JSON.parse(e.data);
        if (typeof data === "string") data = JSON.parse(data); // unwrap stringified JSON

        // BUY success UX
        if (
          data.line?.includes("[🎆 BOUGHT SUCCESS]") ||
          data.line?.includes("[🎆 REBALANCE SUCCESS]") ||
          data.line?.includes("[🎆 SIMULATED BUY]")
        ) {
          const txMatch = data.line.match(/Tx: https:\/\/solscan\.io\/tx\/(\w+)/);
          const txHash = txMatch ? txMatch[1] : null;
          triggerBuyAnimation();
          toast.success(
            <>✅ Auto-buy executed —{txHash ? (
              <> <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View Tx</a></>
            ) : (" Tx unknown")}</>
          );
        }

        // Strategy completed UX
        if (/completed/i.test(data.line)) {
          const stratMatch = data.line.match(/(\w+)\scompleted/i);
          const name = stratMatch ? stratMatch[1] : "Strategy";
          toast.info(`🤖 ${name} session finished`);
        }

        const ts = new Date().toLocaleTimeString([], { hour12: false });
        const text = `[${ts}] ${data.line.trim()}`;
        push({ ...data, text });
      } catch {
        // Server may occasionally emit plain text; ignore parse errors quietly.
      }
    }

    function connect() {
      if (socket) return;

      // Initialize candidates on first run
      if (!candidatesRef.current.length) {
        const list = computeCandidateWsUrls();
        candidatesRef.current = list;
        candidateIndexRef.current = 0;
        debug("candidate URLs:", list);
      }

      const url = currentUrl();
      debug("connecting →", url);
      try {
        socket = new WebSocket(url);
      } catch (e) {
        console.error("Logs WebSocket ctor error:", e?.message || e);
        socket = null;
        advanceCandidate();
        scheduleReconnect(true);
        return;
      }

      reconnectAttemptsRef.current = 0;

      // Use addEventListener so multiple mounts don't clobber handlers
      socket.addEventListener("open", () => {
        debug("connected ✅", url);
        reconnectAttemptsRef.current = 0;
      });
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", (evt) => {
        const { code, reason, wasClean } = evt || {};
        console.warn("Logs WebSocket closed", { url, code, reason, wasClean });
        socket = null;
        // Rotate candidate on policy/handshake-ish closings
        if (code === 1006 || code === 1008 || code === 1011 || code === 1015) {
          advanceCandidate();
        }
        if (!cancelled) scheduleReconnect(false);
      });
      socket.addEventListener("error", (err) => {
        console.error("Logs WebSocket error", err);
        // Let 'close' drive retries; don't double-handle here.
      });
    }

    function scheduleReconnect(immediateBump) {
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;

      // Exponential backoff: 1s, 2s, 4s, ... capped at 30s + jitter.
      const base = Math.min(30000, 1000 * 2 ** attempt);
      const jitter = 1000 + Math.random() * 4000;
      const delay = Math.min(30000, base + jitter);

      const url = currentUrl();
      debug(`reconnect #${attempt} in ~${Math.round(delay / 1000)}s → ${url}`);

      setTimeout(() => {
        if (!cancelled && socketOwnerId === myOwnerIdRef.current) connect();
      }, immediateBump ? 250 : delay);
    }

    // ── Ownership: only the first mounted instance manages lifecycle
    if (!socketOwnerId) {
      socketOwnerId = myOwnerIdRef.current;
      debug("claiming WS ownership");
    }

    if (socketOwnerId === myOwnerIdRef.current) {
      connect();

      // Close cleanly on full page unload (not on StrictMode remounts)
      const onUnload = () => {
        try { socket?.close(1000, "unload"); } catch {}
        socket = null;
        socketOwnerId = null;
      };
      window.addEventListener("beforeunload", onUnload);

      return () => {
        cancelled = true;
        window.removeEventListener("beforeunload", onUnload);
        // DO NOT close the socket here – prevents React 18 StrictMode dev noise.
        // Release ownership so a subsequent mount can reclaim it.
        setTimeout(() => {
          if (socketOwnerId === myOwnerIdRef.current) {
            socketOwnerId = null;
          }
        }, 0);
      };
    } else {
      // Not the owner → this instance is passive
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags?.logs?.throttle]);

  return socket;
}
