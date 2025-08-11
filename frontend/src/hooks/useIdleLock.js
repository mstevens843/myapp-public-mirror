import { useEffect } from "react";
import { authFetch } from "@/utils/apiClient";

export default function useIdleLock({ minutes = 15, onLock }) {
  useEffect(() => {
    let t; const reset = () => { clearTimeout(t); t=setTimeout(lock, minutes*60*1000); };
    const lock = async () => {
      try { onLock?.(); /* e.g. hide balances, blur panes */ }
      catch {}
      try { await authFetch("/api/arm/disarm", { method: "POST" }); } catch {}
    };
    ["mousemove","keydown","click","scroll","visibilitychange","touchstart"].forEach(ev=>window.addEventListener(ev, reset));
    reset();
    return () => ["mousemove","keydown","click","scroll","visibilitychange","touchstart"].forEach(ev=>window.removeEventListener(ev, reset));
  }, [minutes, onLock]);
}
