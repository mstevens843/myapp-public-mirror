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

  // ✨ Added in paper-sim-upgrade
  // Handler for simulation-specific input changes.  Supports nested
  // property names using dot notation (e.g. "latency.quoteMs").  The
  // value is coerced to a number when possible, otherwise left as a
  // string/boolean.  Empty strings clear the field.  Booleans are
  // handled via checkboxes.
  const handleSimChange = (e) => {
    const { name, value, type, checked } = e.target;
    const path = name.split(".");
    wrappedSetConfig((prev) => {
      const next = { ...prev };
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) {
        const p = path[i];
        obj[p] = obj[p] && typeof obj[p] === "object" ? { ...obj[p] } : {};
        obj = obj[p];
      }
      const key = path[path.length - 1];
      let val;
      if (type === "checkbox") {
        val = checked;
      } else if (value === "") {
        val = "";
      } else {
        const num = parseFloat(value);
        val = isNaN(num) ? value : num;
      }
      obj[key] = val;
      return next;
    });
  };

  /* 🖼️ 3)  Render -------------------------------------------------- */
  return (
    <SniperConfig
      config={config}
      setConfig={wrappedSetConfig}
      disabled={disabled}
    >
      {/* Pass through whatever StrategyConfigLoader injects */}
      {children}

      {/* ✨ Added in paper-sim-upgrade: Simulation Settings */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3 space-y-3">
        <h3 className="text-sm font-semibold text-emerald-300">Simulation Settings</h3>
        {/* Execution Model */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">Execution Model</span>
          <select
            name="execModel"
            value={config.execModel ?? "ideal"}
            onChange={handleSimChange}
            className="pl-3 pr-8 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
            disabled={disabled}
          >
            <option value="ideal">ideal (default)</option>
            <option value="amm_depth">amm_depth</option>
            <option value="jito_fallback">jito_fallback</option>
          </select>
        </label>
        {/* Seed */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">Seed (optional)</span>
          <input
            type="text"
            name="seed"
            value={config.seed ?? ""}
            onChange={handleSimChange}
            placeholder="leave blank for random"
            disabled={disabled}
            className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
          />
        </label>
        {/* Slippage Bps Cap */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">Slippage Cap (bps)</span>
          <input
            type="number"
            name="slippageBpsCap"
            step="any"
            value={config.slippageBpsCap ?? ""}
            onChange={handleSimChange}
            placeholder="e.g. 50"
            disabled={disabled}
            className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
          />
        </label>
        {/* Latency model */}
        <div>
          <span className="text-sm font-medium">Latency (ms)</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {['quoteMs','buildMs','sendMs','landMs'].map((key) => (
              <input
                key={key}
                type="number"
                name={`latency.${key}`}
                step="any"
                value={config.latency && config.latency[key] !== undefined ? config.latency[key] : ''}
                onChange={handleSimChange}
                placeholder={key}
                disabled={disabled}
                className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
              />
            ))}
          </div>
        </div>
        {/* Failure rates */}
        <div>
          <span className="text-sm font-medium">Failure Rates (0–1)</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {['blockhashNotFound','accountInUse','slippageExceeded','bundleNotLanded'].map((key) => (
              <input
                key={key}
                type="number"
                name={`failureRates.${key}`}
                step="any"
                value={config.failureRates && config.failureRates[key] !== undefined ? config.failureRates[key] : ''}
                onChange={handleSimChange}
                placeholder={key}
                disabled={disabled}
                className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
              />
            ))}
          </div>
        </div>
        {/* Partials */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span>Min Parts</span>
            <input
              type="number"
              name="partials.minParts"
              step="1"
              value={config.partials && config.partials.minParts !== undefined ? config.partials.minParts : ''}
              onChange={handleSimChange}
              placeholder="1"
              disabled={disabled}
              className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
            />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            <span>Max Parts</span>
            <input
              type="number"
              name="partials.maxParts"
              step="1"
              value={config.partials && config.partials.maxParts !== undefined ? config.partials.maxParts : ''}
              onChange={handleSimChange}
              placeholder="3"
              disabled={disabled}
              className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
            />
          </label>
        </div>
        {/* Enable Shadow Mode */}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enableShadowMode"
            checked={config.enableShadowMode === true}
            onChange={handleSimChange}
            disabled={disabled}
            className="h-4 w-4 border-zinc-700 rounded text-emerald-500 focus:ring-emerald-400"
          />
          <span>Shadow Mode (mirror live orders)</span>
        </label>
        {/* ✨ Added in paper-sim-upgrade: Show seed and run id when provided */}
        {(config.seed || config.paperRunId) && (
          <div className="mt-2 text-xs text-zinc-400 space-y-1">
            {config.seed && (
              <p>
                Seed: <code>{config.seed}</code>
              </p>
            )}
            {config.paperRunId && (
              <p>
                Run ID: <code>{config.paperRunId}</code>
              </p>
            )}
          </div>
        )}
      </div>

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
