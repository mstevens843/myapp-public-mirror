import { useEffect } from "react";
import { useLogsStore } from "@/state/LogsStore";
import { toast } from "react-toastify";
import { triggerBuyAnimation } from "@/utils/tradeFlash";

let socket; // singleton instance

export default function useSingleLogsSocket() {
  const push = useLogsStore((s) => s.push);

  useEffect(() => {
    if (socket) return; // already connected – keep singleton

    socket = new WebSocket("ws://localhost:5001");

    socket.onmessage = (e) => {
      try {
        let data = JSON.parse(e.data);
        if (typeof data === "string") data = JSON.parse(data); // unwrap nested JSON if present

        /* ── 🎆 BUY SUCCESS (any strategy) ───────────────────── */
      if (data.line?.includes("[🎆 BOUGHT SUCCESS]") || data.line?.includes("[🎆 REBALANCE SUCCESS]")
        || data.line?.includes("[🎆 SIMULATED BUY]"
      )) {
          const mintMatch = data.line.match(/\] (\w{32,44})/);
          const mint = mintMatch ? mintMatch[1] : null;

          const txMatch = data.line.match(/Tx: https:\/\/solscan\.io\/tx\/(\w+)/);
          const txHash = txMatch ? txMatch[1] : null;

          triggerBuyAnimation();

          toast.success(
            <span>
              ✅ Auto‑buy executed —
              {txHash ? (
                <>
                  &nbsp;
                  <a
                    href={`https://explorer.solana.com/tx/${txHash}?cluster=mainnet-beta`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View&nbsp;Tx
                  </a>
                </>
              ) : (
                " Tx unknown"
              )}
            </span>,
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
    };

    socket.onclose = () => {
      console.warn("Logs WebSocket closed");
      socket = null; // allow reconnect on reload
    };

    socket.onerror = (err) => {
      console.error("Logs WebSocket error", err);
    };
  }, []);

  return socket;
}