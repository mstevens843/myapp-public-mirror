// ScalperConfig.jsx  ✨ now includes a Strategy Summary card
import React, { useMemo, useEffect, } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* fields required by validator ---------------------------------------- */
export const REQUIRED_FIELDS = [
  "entryThreshold",
   "priceWindow",
  "volumeThreshold",
  "volumeWindow",
];
/* feed selector options ----------------------------------------------- */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

const ScalperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* defaults once ----------------------------------------------------- */
  const defaults = {
    entryThreshold : 1,
    priceWindow    : "5m",
    volumeThreshold: 500,
    volumeWindow   : "5m",
    volumeSpikeMultiplier: "", 
    // NEW: disable signals by default; toggled on in advanced settings
    useSignals: false,
    // NEW: default execution shape (empty = single swap)
    executionShape: "",
  };
  const merged = useMemo(() => ({ ...defaults, ...config }), [config]);

  const handle = ({ target }) =>
    setConfig((p) => ({
      ...p,
      [target.name]:
        ["priceWindow","volumeWindow"].includes(target.name)
          ? target.value
          : target.value === "" ? "" : parseFloat(target.value),
    }));

  /* options ----------------------------------------------------------- */
  const priceWins  = ["1m","5m"];
  const volumeWins = ["1m","5m"];

    /* ────────────────────────────────────────────────────────────
     Force‑reset invalid window settings when the user switches
     in from another strategy (e.g. Breakout’s 30 m).  
     This prevents stale values from leaking into the ConfirmModal.
  ‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑ */
  useEffect(() => {
    if (!priceWins.includes(config.priceWindow)) {
      setConfig((p) => ({ ...p, priceWindow: defaults.priceWindow }));
    }
    if (!volumeWins.includes(config.volumeWindow)) {
      setConfig((p) => ({ ...p, volumeWindow: defaults.volumeWindow }));
    }
  }, [config.priceWindow, config.volumeWindow]);

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white " +
    "placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500";

const summaryTokenList = merged.overrideMonitored
  ? "📝 My Monitored"
  : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");
    

    // Clamp summary to valid select values
const summaryPriceWindow = priceWins.includes(merged.priceWindow) ? merged.priceWindow : priceWins[0];
const summaryVolumeWindow = volumeWins.includes(merged.volumeWindow) ? merged.volumeWindow : volumeWins[0];
  /* ============================================================= */
  return (
    <>
      {/* ——— description ——— */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
        ⚡ Rapidly scalps top-trending tokens using ultra-fast 1 m / 5 m momentum signals.
      </div>

      {/* ——— Pump % + window ——— */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          Entry Threshold (%) <StrategyTooltip name="entryThreshold" />
          <input
            type="number"
            name="entryThreshold"
            step="any"
            value={merged.entryThreshold}
            onChange={handle}
            disabled={disabled}
            placeholder="e.g. 0.5"
            className={inp}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          Pump Window <StrategyTooltip name="priceWindow" />
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

      {/* ——— Volume + window ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          Volume Floor (USD) <StrategyTooltip name="volumeThresholdUSD" />
          <input
            type="number"
            name="volumeThreshold"
            step="any"
            value={merged.volumeThreshold}
            onChange={handle}
            disabled={disabled}
            placeholder="e.g. 500"
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
      </div>
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

      {/* ——— shared blocks ——— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields      config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* ——— Strategy summary ——— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊 <span className="text-pink-400 font-semibold">Scalper Summary</span> — 
          List:&nbsp;
          <span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;&nbsp;
          Pump&nbsp;<span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span> in&nbsp;
          <span className="text-indigo-300 font-semibold">{summaryPriceWindow}</span>; Volume&nbsp;
          <span className="text-emerald-300 font-semibold">
            ≥ ${(+merged.volumeThreshold).toLocaleString()}
          </span> in&nbsp;
          <span className="text-indigo-300 font-semibold">{summaryVolumeWindow}</span>
          {(merged.minMarketCap || merged.maxMarketCap) && (
            <>; MC&nbsp;
              {merged.minMarketCap && (
                <>≥ <span className="text-orange-300 font-semibold">
                  ${(+merged.minMarketCap).toLocaleString()}
                </span></>
              )}
              {merged.minMarketCap && merged.maxMarketCap && " / "}
              {merged.maxMarketCap && (
                <>≤ <span className="text-orange-300 font-semibold">
                  ${(+merged.maxMarketCap).toLocaleString()}
                </span></>
              )}
              {merged.volumeSpikeMultiplier && (
                <>; Spike&nbsp;×
                  <span className="text-yellow-300 font-semibold">{merged.volumeSpikeMultiplier}</span>
                </>
              )}
              
            </>
          )}
        </p>
      </div>
    </>
  );
};

export default ScalperConfig;
