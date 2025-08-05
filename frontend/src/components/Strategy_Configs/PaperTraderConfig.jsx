// PaperTraderConfig.jsx  ✨ Sniper‑equivalent UI in permanent dry‑run mode
//-----------------------------------------------------------------------

import React, { useEffect } from "react";
import SniperConfig from "./SniperConfig";

/**
 * PaperTraderConfig
 * -----------------
 * A very thin wrapper around <SniperConfig>.  
 *  • Re‑uses every field, default, and helper from Sniper.  
 *  • Hard‑codes `dryRun: true` into the config object.  
 *  • Adds its own summary footer (“Paper Sniper (sim)”).
 */
export default function PaperTraderConfig({
  config = {},
  setConfig,
  disabled,
  children,
}) {
  /* 🔐 1)  Ensure dryRun *always* true ---------------------------- */
  useEffect(() => {
    if (config?.dryRun !== true) {
      setConfig((prev) => ({ ...prev, dryRun: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 🔄 2)  Wrap SniperConfig’s setConfig to keep dryRun locked ---- */
  const wrappedSetConfig = (updater) =>
    setConfig((prev) => {
      const next =
        typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      return { ...next, dryRun: true };
    });

  /* 🖼️ 3)  Render -------------------------------------------------- */
  return (
    <SniperConfig
      config={config}
      setConfig={wrappedSetConfig}
      disabled={disabled}
    >
      {/* Pass through whatever StrategyConfigLoader injects */}
      {children}

      {/* Replace / supplement the Sniper summary with a sim notice */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊{" "}
          <span className="text-pink-400 font-semibold">
            Paper Sniper&nbsp;(sim)
          </span>{" "}
          — identical filters to Sniper, but it{" "}
          <span className="text-emerald-300 font-semibold">never spends SOL</span>.
          Trades are executed in permanent <code>dryRun</code> mode and excluded
          from real PnL.
        </p>
      </div>
    </SniperConfig>
  );
}
