import { useEffect, useRef } from "react";
import { useLogsStore } from "@/state/LogsStore";
import { toast } from "react-toastify";
import { triggerBuyAnimation } from "@/utils/tradeFlash";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

// Convert base URL to WebSocket URL (ws://...).  Derive a WebSocket
// origin from the configured API base or fallback to the current
// location.  If VITE_API_BASE_URL is undefined the replace() call on
// undefined would throw, so we guard against that and compute a
// sensible default.  When a specific WS base is provided via
// VITE_WS_BASE_URL you can still override this in ws.js.
let WS_URL;
{
  const apiBase = import.meta.env.VITE_API_BASE_URL;
  if (apiBase) {
    try {
      const url = new URL(apiBase, window.location.origin);
      WS_URL = url.origin.replace(/^http/, "ws");
    } catch {
      WS_URL = apiBase.replace(/^http/, "ws");
    }
  } else {
    WS_URL = window.location.origin.replace(/^http/, "ws");
  }
}

// Singleton socket instance.  It will be lazily created by the hook
// and reused across calls.  When closed or stale it will be reset to
// null so that a new connection can be established.
let socket = null;

export default function useSingleLogsSocket() {
  const push = useLogsStore((s) => s.push);
  const { flags } = useFeatureFlags();
  // Record the last time a message was processed; used for throttling
  const lastProcessedRef = useRef(0);
  // Track last received message timestamp to detect stale sockets
  const lastMessageRef = useRef(Date.now());
  // Track reconnection attempts for exponential backoff
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function handleMessage(e) {
      lastMessageRef.current = Date.now();
      // Throttle onmessage if the logs.throttle flag is enabled
      if (flags?.logs?.throttle) {
        const now = Date.now();
        // Limit to ~100 messages per second (10 ms per message)
        if (now - lastProcessedRef.current < 10) return;
        lastProcessedRef.current = now;
      }
      try {
        let data = JSON.parse(e.data);
        if (typeof data === "string") data = JSON.parse(data); // unwrap nested JSON if present

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
            <>✅ Auto‑buy executed —{txHash ? (<>
              &nbsp;
              <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View Tx</a>
            </>) : (
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
        console.warn("Invalid WS message:", e.data);
      }
    }

    function connect() {
      if (socket) return;
      socket = new WebSocket(WS_URL);
      reconnectAttemptsRef.current = 0;
      socket.onopen = () => {
        lastMessageRef.current = Date.now();
        reconnectAttemptsRef.current = 0;
      };
      socket.onmessage = handleMessage;
      socket.onclose = () => {
        // Null out the socket so a new connection can be created
        socket = null;
        if (!cancelled) scheduleReconnect();
      };
      socket.onerror = (err) => {
        console.error("Logs WebSocket error", err);
      };
    }

    function scheduleReconnect() {
      reconnectAttemptsRef.current += 1;
      // Exponential backoff: 1 s, 2 s, 4 s, etc., but cap the base at
      // 30 s.  Add 1–5 s of random jitter on top to avoid thundering herd.
      const base = Math.min(30000, 1000 * 2 ** reconnectAttemptsRef.current);
      const jitter = 1000 + Math.random() * 4000;
      const delay = Math.min(30000, base + jitter);
      setTimeout(() => {
        if (!cancelled) connect();
      }, delay);
    }

    // Periodically check for stale connections.  If no messages have
    // been received for 30 seconds, assume the socket is dead and
    // trigger a reconnect by closing it.  The onclose handler will
    // schedule the reconnect.
    const staleCheck = setInterval(() => {
      if (!socket) return;
      if (Date.now() - lastMessageRef.current > 30000) {
        console.warn("Logs WebSocket stale, reconnecting…");
        socket.close();
      }
    }, 5000);

    connect();

    return () => {
      cancelled = true;
      clearInterval(staleCheck);
      if (socket) {
        socket.close();
        socket = null;
      }
    };
  }, [flags?.logs?.throttle]);

  return socket;
}