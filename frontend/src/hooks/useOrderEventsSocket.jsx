/* eslint-disable no-console */
import { useEffect } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useLogsStore } from "@/state/LogsStore";

const shortMint = (m = "") =>
  m && m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m;

function titleFor(ev) {
  const { source, side, trigger } = ev || {};
  if (source === "tpsl") {
    const label = trigger === "tp" ? "Take Profit" : "Stop Loss";
    return `${label} sell executed`;
  }
  if (source === "smart_exit" || source === "smart-exit") {
    if (trigger === "smart_time") return "Smart Exit (time) sell executed";
    if (trigger === "smart_liquidity") return "Smart Exit (liquidity) sell executed";
    return "Smart Exit sell executed";
  }
  if (source === "limit")
    return `Limit ${side === "sell" ? "sell" : "buy"} executed`;
  if (source === "dca")
    return `DCA ${side === "sell" ? "sell" : "buy"} executed`;
  return `Order ${side === "sell" ? "sell" : "buy"} executed`;
}

/** Helpers */
function isOrderEvent(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    obj.type === "order_executed" &&
    (obj.channel === "events" || obj.channel == null)
  );
}

function tryParseJSON(s) {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  // Handle optional "[FEVENT]" prefix
  const withoutPrefix = trimmed.replace(/^\s*\[FEVENT\]\s*/i, "").trim();
  // Fast path: whole string is JSON
  if (withoutPrefix.startsWith("{") && withoutPrefix.endsWith("}")) {
    try { return JSON.parse(withoutPrefix); } catch {}
  }
  // Fallback: extract the first {...} block
  const first = withoutPrefix.indexOf("{");
  const last = withoutPrefix.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(withoutPrefix.slice(first, last + 1)); } catch {}
  }
  return null;
}

export default function useOrderEventsSocket() {
  useEffect(() => {
    const handler = (evt) => {
      const raw = evt?.detail;
      console.groupCollapsed("[orders-bridge] logs:message");
      console.log("raw detail:", raw);

      // Step 1: normalize incoming payload to an object
      let data = raw;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
          console.log("parsed JSON:", data);
        } catch (e) {
          console.warn("parse failed for raw string; ignoring", e);
          console.groupEnd();
          return;
        }
      } else {
        console.log("using object directly:", data);
      }

      // Step 2: detect event directly OR unwrap from `line` / `[FEVENT] { ... }`
      let ev = null;

      // A) direct event (some backends send pure event objects)
      if (isOrderEvent(data)) {
        ev = data;
      }

      // B) log-wrapper with an inner JSON line
      if (!ev && data && typeof data.line === "string") {
        const inner = tryParseJSON(data.line);
        if (inner && isOrderEvent(inner)) {
          ev = inner;
          console.log("✅ extracted event from .line");
        }
      }

      if (!ev) {
        console.log("ignoring: not {channel:'events', type:'order_executed'}");
        console.groupEnd();
        return;
      }

      // Step 3: toast
      const title = titleFor(ev);
      const suffix = ev.mint ? ` — ${shortMint(ev.mint)}` : "";
      const href = ev.txHash
        ? `https://explorer.solana.com/tx/${ev.txHash}?cluster=mainnet-beta`
        : null;

      const id = `order:${ev.source || ev.strategy || "unknown"}:${ev.side || "?"}:${
        ev.txHash || ev.orderId || ev.ruleId || ev.ts || Math.random().toString(36).slice(2)
      }`;

      console.log("✅ toasting", { id, title, href, source: ev.source, trigger: ev.trigger });
      toast.success(`${title}${suffix}`, {
        id,
        duration: 9000,
        icon: <Check size={18} strokeWidth={2} />,
        ...(href && {
          action: {
            label: "View Tx",
            onClick: () => window.open(href, "_blank", "noopener,noreferrer"),
          },
        }),
      });

      // Step 4: push compact log line to the panel
      try {
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        const line = `[EVENT] ${title}${ev.mint ? ` ${shortMint(ev.mint)}` : ""}${
          ev.txHash ? ` tx=${String(ev.txHash).slice(0, 8)}…` : ""
        }`;
        console.log("pushing to LogsStore:", line);
        useLogsStore.getState().push({ ...ev, line, text: `[${ts}] ${line}` });
      } catch (e) {
        console.warn("push to LogsStore failed", e);
      }

      // Step 5: fan-out for any listeners
      try {
        window.dispatchEvent(new CustomEvent("orders:executed", { detail: ev }));
        console.log("dispatched orders:executed", ev);
      } catch (e) {
        console.warn("dispatch orders:executed failed", e);
      }

      console.groupEnd();
    };

    window.addEventListener("logs:message", handler);
    console.info("[orders-bridge] listening on logs:message");
    return () => {
      window.removeEventListener("logs:message", handler);
      console.info("[orders-bridge] stopped listening on logs:message");
    };
  }, []);

  return null;
}
