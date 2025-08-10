// BreakoutConfig.jsx  ✨ now includes a Strategy Summary card
import React, { useMemo } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  "volumeSpikeMultiplier",
  "minLiquidity",
  "monitoredTokens",
  "overrideMonitored",
  // Expose new advanced toggles
  "useSignals",
  "executionShape",
];

const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

const BreakoutConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* defaults ---------------------------------------------------------- */
  const defaults = {
    breakoutThreshold     : 5,
    priceWindow           : "30m",
    volumeThreshold       : 100_000,
    volumeWindow          : "1h",
    volumeSpikeMultiplier : 2.5,
    minLiquidity          : 200_000,
    tokenFeed             : "monitored",
    monitoredTokens       : "",
    overrideMonitored     : false,
    // NEW: disable signals by default so Breakout behaves like Sniper
    useSignals           : false,
    // NEW: default execution shape (empty string defers to single swap)
    executionShape       : "",
  };
  const merged = useMemo(() => ({ ...defaults, ...config }), [config]);

  const priceWins  = ["30m","1h","2h","4h"];
  const volumeWins = ["30m","1h","2h","4h","8h"];

  const handle = ({ target }) =>
    setConfig((p) => ({
      ...p,
      [target.name]:
        ["priceWindow","volumeWindow"].includes(target.name)
          ? target.value
          : target.value === "" ? "" : parseFloat(target.value),
    }));

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

 // Clamp summary to valid select values
const summaryPriceWindow = priceWins.includes(merged.priceWindow) ? merged.priceWindow : priceWins[0];
const summaryVolumeWindow = volumeWins.includes(merged.volumeWindow) ? merged.volumeWindow : volumeWins[0];

// Determine token list summary
const summaryTokenList = merged.overrideMonitored
  ? "📝 My Monitored"
  : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");


  return (
    <>
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-3">
        🚀 Detects sudden price/volume break-outs on monitored tokens and enters early.
      </div>

      {/* ——— Price surge —— */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          Pump Threshold (%) <StrategyTooltip name="breakoutThreshold" />
          <input
            type="number"
            name="breakoutThreshold"
            value={merged.breakoutThreshold}
            onChange={handle}
            disabled={disabled}
            placeholder="e.g. 5"
            className={inp}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          Pump Time Window <StrategyTooltip name="priceWindow" />
          <div className="relative">
            <select
              name="priceWindow"
              value={merged.priceWindow}
              onChange={handle}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              {priceWins.map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* ——— Volume floor —— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          Volume Floor (USD) <StrategyTooltip name="volumeThreshold" />
          <input
            type="number"
            name="volumeThreshold"
            value={merged.volumeThreshold}
            onChange={handle}
            disabled={disabled}
            placeholder="e.g. 100000"
            className={inp}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          Volume Window <StrategyTooltip name="volumeWindow" />
          <div className="relative">
            <select
              name="volumeWindow"
              value={merged.volumeWindow}
              onChange={handle}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              {volumeWins.map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>

        {/* ——— Volume spike —— */}
        <label className="flex flex-col text-sm font-medium gap-1 mt-4">
          Volume Spike × <StrategyTooltip name="volumeSpikeMultiplier" />
          <input
            type="number"
            name="volumeSpikeMultiplier"
            step="any"
            min={1.1}
            value={merged.volumeSpikeMultiplier}
            onChange={handle}
            disabled={disabled}
            placeholder="e.g. 2"
            className={inp}
          />
        </label>

        {/* ——— Signals & Execution Shape —— */}
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          {/* Toggle to enable custom signal computation on the backend */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="useSignals"
              checked={!!merged.useSignals}
              onChange={() =>
                setConfig((p) => ({ ...p, useSignals: !p.useSignals }))
              }
              disabled={disabled}
              className="accent-emerald-500 w-4 h-4"
            />
            <span className="flex items-center gap-1">
              Enable Signals <StrategyTooltip name="useSignals" />
            </span>
          </label>

          {/* Select the execution shape for breakout orders */}
          <label className="flex flex-col text-sm font-medium">
            <span className="flex items-center gap-1">
              Execution Shape <StrategyTooltip name="executionShape" />
            </span>
            <div className="relative">
              <select
                name="executionShape"
                value={merged.executionShape ?? ""}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, executionShape: e.target.value }))
                }
                disabled={disabled}
                className={`${inp} appearance-none pr-10`}
              >
                <option value="">Default</option>
                <option value="TWAP">TWAP</option>
                <option value="ATOMIC">Atomic Scalp</option>
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </label>
        </div>
      </div>

      {/* ——— Shared controls ——— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields      config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* ——— Strategy summary ——— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
<p className="text-xs text-right leading-4">
  📊 <span className="text-pink-400 font-semibold">Breakout Summary</span> — 
  List:&nbsp;<span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;&nbsp;
  Pump&nbsp;<span className="text-emerald-300 font-semibold">
    ≥ {merged.breakoutThreshold}%
  </span> in&nbsp;
  <span className="text-indigo-300 font-semibold">{summaryPriceWindow}</span>; Volume&nbsp;
  <span className="text-emerald-300 font-semibold">
    ≥ ${(+merged.volumeThreshold).toLocaleString()}
  </span> in&nbsp;
  <span className="text-indigo-300 font-semibold">{summaryVolumeWindow}</span>
  {merged.volumeSpikeMultiplier && (
    <>; Spike&nbsp;×
      <span className="text-yellow-300 font-semibold">{merged.volumeSpikeMultiplier}</span>
    </>
  )}
  {merged.minLiquidity && (
    <>; LP&nbsp;≥&nbsp;
      <span className="text-orange-300 font-semibold">
        ${(+merged.minLiquidity).toLocaleString()}
      </span>
    </>
  )}
</p>

      </div>
    </>
  );
};

export default BreakoutConfig;
