/**
 * useSingleLogsSocket.jsx
 * ------------------------------------------------------------------
 * What changed
 *  - Added robust WS URL resolution with path support and fallbacks.
 *  - Tries VITE_WS_BASE_URL (fully-qualified), then VITE_WS_PATH
 *    (default "/ws/logs"), then "/logs", then "/ws".
 *  - Better diagnostics: logs attempted URL, onclose code/reason.
 *  - Safe singleton with stale-check + exponential backoff preserved.
 *  - Runtime override: window.__SET_LOGS_WS__(url) to force a URL.
 *
 * Why
 *  - Connecting to the WS origin "/" commonly fails (handshake refused)
 *    because most servers only upgrade at a specific path.
 *
 * Risk addressed
 *  - Silent WS failures on "/", hard-to-debug 1006 closes.
 * ------------------------------------------------------------------ */

import { useEffect, useRef } from "react";
import { useLogsStore } from "@/state/LogsStore";
import { toast } from "react-toastify";
import { triggerBuyAnimation } from "@/utils/tradeFlash";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

// --------------------------- URL resolution ---------------------------

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

function toWsUrl(httpishUrl) {
  // http://... -> ws://...   https://... -> wss://...
  return httpishUrl.replace(/^http/i, "ws");
}

function joinPath(base, path) {
  // base: http(s)://host[:port]
  // path: "/ws/logs" (ensure it starts with /)
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

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

// Singleton socket instance + state
let socket = null;
let overrideUrl = null; // runtime override

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
}

export default function useSingleLogsSocket() {
  const push = useLogsStore((s) => s.push);
  const { flags } = useFeatureFlags();

  // Throttle + stale detection
  const lastProcessedRef = useRef(0);
  const lastMessageRef = useRef(Date.now());

  // Reconnect/backoff bookkeeping
  const reconnectAttemptsRef = useRef(0);
  const candidateIndexRef = useRef(0);
  const candidatesRef = useRef([]);

  useEffect(() => {
    let cancelled = false;

    function logDebug(...args) {
      // Toggle verbose WS logs by setting: window.__LOGS_WS_DEBUG__ = true
      if (typeof window !== "undefined" && window.__LOGS_WS_DEBUG__) {
        console.debug("[logs-ws]", ...args);
      }
    }

    function handleMessage(e) {
      lastMessageRef.current = Date.now();

      // Optional throttle
      if (flags?.logs?.throttle) {
        const now = Date.now();
        if (now - lastProcessedRef.current < 10) return; // ~100/s
        lastProcessedRef.current = now;
      }

      try {
        let data = JSON.parse(e.data);
        if (typeof data === "string") data = JSON.parse(data); // unwrap stringified JSON

        /* ── 🎆 BUY SUCCESS (any strategy) ───────────────────── */
        if (
          data.line?.includes("[🎆 BOUGHT SUCCESS]") ||
          data.line?.includes("[🎆 REBALANCE SUCCESS]") ||
          data.line?.includes("[🎆 SIMULATED BUY]")
        ) {
          const mintMatch = data.line.match(/\] (\w{32,44})/);
          const mint = mintMatch ? mintMatch[1] : null;

          const txMatch = data.line.match(/Tx: https:\/\/solscan\.io\/tx\/(\w+)/);
          const txHash = txMatch ? txMatch[1] : null;

          triggerBuyAnimation();

          toast.success(
            <>✅ Auto-buy executed —{txHash ? (
              <>
                &nbsp;
                <a
                  href={`https://solscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Tx
                </a>
              </>
            ) : (
              " Tx unknown"
            )}</>,
            {
              icon: "🤖",
              id: `auto-buy-${mint || "unknown"}`,
              autoClose: 9000,
            }
          );
        }

        /* ── ✅ STRATEGY COMPLETED (generic) ─────────────────── */
        if (/completed/i.test(data.line)) {
          const stratMatch = data.line.match(/(\w+)\scompleted/i);
          const name = stratMatch ? stratMatch[1] : "Strategy";
          toast.info(`🤖 ${name} session finished`, {
            icon: "✅",
            autoClose: 5000,
          });
        }

        /* ── store pretty line ───────────────────────────────── */
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        const text = `[${ts}] ${data.line.trim()}`;
        push({ ...data, text });
      } catch {
        console.warn("[logs-ws] invalid message:", e.data);
      }
    }

    function currentUrl() {
      if (overrideUrl) return overrideUrl;
      const list = candidatesRef.current;
      const i = Math.min(candidateIndexRef.current, list.length - 1);
      return list[i];
    }

    function advanceCandidate() {
      const list = candidatesRef.current;
      if (list.length <= 1) return;
      candidateIndexRef.current = (candidateIndexRef.current + 1) % list.length;
      logDebug("advance candidate ->", currentUrl());
    }

    function connect() {
      if (socket) return;

      // Initialize candidates on first run
      if (!candidatesRef.current.length) {
        const list = computeCandidateWsUrls();
        candidatesRef.current = list;
        candidateIndexRef.current = 0;
        logDebug("candidate URLs:", list);
      }

      const url = currentUrl();
      logDebug("connecting →", url);
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

      socket.onopen = () => {
        logDebug("connected ✅", url);
        lastMessageRef.current = Date.now();
        reconnectAttemptsRef.current = 0;
      };
      socket.onmessage = handleMessage;
      socket.onclose = (evt) => {
        const { code, reason, wasClean } = evt || {};
        console.warn(
          "Logs WebSocket closed",
          { url, code, reason, wasClean }
        );
        // Null out the socket so a new connection can be established
        socket = null;
        // If the close looks like a handshake refusal or policy issue,
        // try the next candidate path on the next attempt.
        if (code === 1006 || code === 1008 || code === 1011 || code === 1015) {
          advanceCandidate();
        }
        if (!cancelled) scheduleReconnect(false);
      };
      socket.onerror = (err) => {
        console.error("Logs WebSocket error", err);
        // Some servers emit error before close; try advancing early.
        advanceCandidate();
      };
    }

    function scheduleReconnect(immediateBump) {
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;

      // Exponential backoff: 1s, 2s, 4s, ... capped at 30s + jitter.
      const base = Math.min(30000, 1000 * 2 ** attempt);
      const jitter = 1000 + Math.random() * 4000;
      const delay = Math.min(30000, base + jitter);

      const url = currentUrl();
      logDebug(`reconnect #${attempt} in ~${Math.round(delay / 1000)}s → ${url}`);

      setTimeout(() => {
        if (!cancelled) connect();
      }, immediateBump ? 250 : delay);
    }

    // Kill stale sockets (no messages in 30s) and let onclose handle retry.
    const staleCheck = setInterval(() => {
      if (!socket) return;
      if (Date.now() - lastMessageRef.current > 30000) {
        console.warn("[logs-ws] stale (>30s w/o messages), reconnecting…");
        try { socket.close(); } catch {}
      }
    }, 5000);

    connect();

    return () => {
      cancelled = true;
      clearInterval(staleCheck);
      if (socket) {
        try { socket.close(); } catch {}
        socket = null;
      }
    };
  }, [flags?.logs?.throttle]);

  return socket;
}
