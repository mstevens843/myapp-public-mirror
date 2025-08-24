/* =============================================================================
   PaperTurboTraderConfig.jsx  ✨ Turbo-Sniper-equivalent UI in permanent dry-run mode
   -----------------------------------------------------------------------------
   • Mirrors TurboSniperConfig fields 1:1 so the paper strategy has identical knobs
   • Forces dryRun true and stamps extras that the backend can echo into metadata
   • Exposes Simulation Settings (exec model, latency, failure rates, partial fills)
   • Shows a clear "Paper" banner and safety disclaimer
   ============================================================================= */

import React, { useMemo } from "react";
import TurboSniperConfig from "./TurboSniperConfig";
import AdvancedSection from "../ui/AdvancedSection";


const Card = ({ title, right, children, className = "" }) => (
  <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 sm:p-4 ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between mb-3">
        {title ? <div className="text-sm font-semibold text-zinc-200">{title}</div> : <div />}
        {right}
      </div>
    )}
    {children}
  </div>
);



export default function PaperTurboTraderConfig({
  config,
  setConfig,
  disabled,
  children,
}) {
  const merged = useMemo(() => {
    return {
      ...config,
      dryRun: true,
      meta: {
        ...(config?.meta || {}),
        strategy: "Paper Trader",
      },
      openTradeExtras: {
        ...(config?.openTradeExtras || {}),
        isPaper: true,
        simulated: true,
        strategy: "Paper Trader",
      },
      ui: {
        ...(config?.ui || {}),
        label: "Turbo PaperTrader",
        isPaper: true,
      },
    };
  }, [config]);

  const handleChange = (next) => {
    setConfig((prev) => ({
      ...prev,
      ...next,
      dryRun: true,
      meta: { ...(prev?.meta || {}), strategy: "Paper Trader" },
      openTradeExtras: {
        ...(prev?.openTradeExtras || {}),
        isPaper: true,
        simulated: true,
        strategy: "Paper Trader",
      },
      ui: { ...(prev?.ui || {}), label: "Turbo PaperTrader", isPaper: true },
    }));
  };

  /* ------------------------ Simulation Settings editor ---------------------- */
  const handleSimChange = (patch) => {
    setConfig((prev) => ({
      ...prev,
      ...patch,
      dryRun: true,
      meta: { ...(prev?.meta || {}), strategy: "Paper Trader" },
      openTradeExtras: {
        ...(prev?.openTradeExtras || {}),
        isPaper: true,
        simulated: true,
        strategy: "Paper Trader",
      },
    }));
  };

  const handleSimBlur = (key, raw) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    handleSimChange({ [key]: num });
  };

  return (
    <>
      {/* Banner / Warning */}
      <Card className="mb-3 bg-pink-50 border-pink-200">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-pink-200 text-pink-800">
            PAPER MODE
          </span>
          <div className="text-pink-900 text-sm">
            Trades are simulated only. No SOL will be spent. Results appear in
            Metrics and Charts with a <strong>“Paper Trader”</strong> tag and
            are excluded from real PnL aggregates.
          </div>
        </div>
      </Card>

      {/* Simulation Settings */}
      <AdvancedSection title="Simulation Settings">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-sm">
            Exec Model
            <select
              disabled={disabled}
              value={config.execModel || "ideal"}
              onChange={(e) => handleSimChange({ execModel: e.target.value })}
              className="input"
            >
              <option value="ideal">ideal</option>
              <option value="latency">latency</option>
              <option value="partial-fills">partial-fills</option>
              <option value="stress">stress</option>
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Seed (deterministic)
            <input
              disabled={disabled}
              type="number"
              className="input"
              value={config.seed ?? ""}
              onChange={(e) => handleSimChange({ seed: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            Slippage Bps Cap
            <input
              disabled={disabled}
              type="number"
              className="input"
              value={config.slippageBpsCap ?? ""}
              onChange={(e) => handleSimChange({ slippageBpsCap: e.target.value })}
              onBlur={(e) => handleSimBlur("slippageBpsCap", e.target.value)}
            />
          </label>

          <label className="flex flex-col text-sm col-span-2">
            Latency (ms JSON)
            <input
              disabled={disabled}
              className="input font-mono"
              placeholder='e.g. {"p50":120,"p95":250}'
              value={
                config.latency
                  ? JSON.stringify(config.latency)
                  : ""
              }
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value || "{}");
                  handleSimChange({ latency: parsed });
                } catch {
                  /* ignore typing errors */
                }
              }}
            />
          </label>

          <label className="flex flex-col text-sm col-span-2">
            Failure Rates (JSON)
            <input
              disabled={disabled}
              className="input font-mono"
              placeholder='e.g. {"quote":0.01,"tx":0.02}'
              value={
                config.failureRates
                  ? JSON.stringify(config.failureRates)
                  : ""
              }
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value || "{}");
                  handleSimChange({ failureRates: parsed });
                } catch {}
              }}
            />
          </label>

          <label className="flex flex-col text-sm col-span-2">
            Partial Fills (JSON)
            <input
              disabled={disabled}
              className="input font-mono"
              placeholder='e.g. {"buy":[0.6,0.4],"sell":[1]}'
              value={
                config.partials
                  ? JSON.stringify(config.partials)
                  : ""
              }
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value || "{}");
                  handleSimChange({ partials: parsed });
                } catch {}
              }}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={!!config.enableShadowMode}
              onChange={(e) =>
                handleSimChange({ enableShadowMode: e.target.checked })
              }
            />
            Enable Shadow Mode
          </label>
        </div>
      </AdvancedSection>

      {/* Under the hood, use the TurboSniper UI — it already has all the knobs */}
      <TurboSniperConfig
        config={merged}
        setConfig={handleChange}
        disabled={disabled}
      >
        {children}
        <div className="text-xs text-muted-foreground mt-2">
          📊 <span className="text-pink-400 font-semibold">Turbo PaperTrader (sim)</span> — identical
          filters to Turbo Sniper, never spends SOL, and writes full trade rows
          tagged as <em>Paper</em>.
        </div>
      </TurboSniperConfig>
    </>
  );
}
