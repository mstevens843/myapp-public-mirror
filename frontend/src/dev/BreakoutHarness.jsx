import React, { useState, useEffect } from "react";
import BreakoutConfig from "../components/Strategy_Configs/BreakoutConfig";

/**
 * BreakoutHarness provides a minimal page for manual testing of the
 * BreakoutConfig component in isolation.  It includes a toggle to simulate
 * parent‑level normalization/clobbering on every change.  When the toggle is
 * enabled, an interval runs that writes a sanitized copy of the config back
 * into state on a regular cadence.  If the active field guard in
 * BreakoutConfig and ConfigModal is working correctly, continuous typing
 * should remain smooth even under this churn.
 */
const BreakoutHarness = () => {
  const [config, setConfig] = useState({});
  const [clobber, setClobber] = useState(false);

  // When clobber is enabled, periodically overwrite the config with a
  // sanitized version.  We intentionally leave the active field untouched in
  // this effect by reading window.__BREAKOUT_ACTIVE_FIELD.  This simulates
  // what a global normalizer might do.
  useEffect(() => {
    if (!clobber) return;
    const id = setInterval(() => {
      const active = typeof window !== "undefined" ? window.__BREAKOUT_ACTIVE_FIELD : null;
      setConfig((prev) => {
        const sanitized = { ...prev };
        // Example: ensure breakoutThreshold is coerced to number if not active
        if (active !== "breakoutThreshold") {
          const raw = prev.breakoutThreshold;
          if (raw === "" || raw === null || raw === undefined) {
            sanitized.breakoutThreshold = "";
          } else {
            const num = Number(raw);
            sanitized.breakoutThreshold = Number.isFinite(num) ? num : "";
          }
        }
        return sanitized;
      });
    }, 500);
    return () => clearInterval(id);
  }, [clobber]);

  return (
    <div className="p-4 space-y-4">
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={clobber}
          onChange={(e) => setClobber(e.currentTarget.checked)}
          className="accent-emerald-500 h-4 w-4"
        />
        <span>Simulate parent clobber (normalizer)</span>
      </label>
      <div className="border border-zinc-700 rounded-lg p-4 bg-zinc-900">
        <BreakoutConfig config={config} setConfig={setConfig} />
      </div>
    </div>
  );
};

export default BreakoutHarness;