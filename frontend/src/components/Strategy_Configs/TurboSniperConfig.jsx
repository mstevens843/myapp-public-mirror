// SniperConfig.jsx – Turbo + Advanced Flags + Strategy Summary
import React, { useMemo } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

/* fields surfaced in Advanced / Summary -------------------------------- */
export const OPTIONAL_FIELDS = [
  "priceWindow","volumeWindow",
  "minTokenAgeMinutes","maxTokenAgeMinutes",
  "minMarketCap","maxMarketCap",
  "tokenFeed","monitoredTokens","overrideMonitored",
  "turboMode","autoRiskManage","privateRpcUrl",
];

/* ─────────────────────────────────────────────────────────────────────── */
const turboSniperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* sensible defaults */
  const defaults = {
    entryThreshold : 3,
    volumeThreshold: 50_000,
    priceWindow    : "1h",
    volumeWindow   : "24h",
    tokenFeed      : "new",
    monitoredTokens: "",
    overrideMonitored: false,
    minMarketCap   : "",
    maxMarketCap   : "",
    dipThreshold   : "",
    delayBeforeBuyMs   : "",
    priorityFeeLamports: "",
    /* MEV prefs */
    mevMode       : "fast",
    briberyAmount : 0.002,
    /* Turbo / risk flags */
    turboMode     : false,
    autoRiskManage: false,
    privateRpcUrl : "",
    /* Advanced sniper flags (restored) */
    ghostMode      : false,
    coverWalletId  : "",
    multiBuy       : false,
    multiBuyCount  : 2,
    prewarmAccounts: false,
    multiRoute     : false,
    autoRug        : false,
  };
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* generic change handler */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : ["priceWindow","volumeWindow","coverWalletId"].includes(name)
            ? value
            : value === "" ? "" : parseFloat(value),
    }));
  };

  /* select options */
  const priceWins  = ["", "1m","5m","15m","30m","1h","2h","4h","6h"];
  const volumeWins = ["", "1m","5m","30m","1h","4h","8h","24h"];

  const inpCls =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  /* ==================================================================== */
  return (
    <>
      {/* description */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-3">
        This strategy hunts early-stage listings, letting you tune price &amp; volume
        windows, token age, and more to precision-snipe brand-new or trending tokens.
      </div>

      {/* thresholds */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Pump Threshold (%) <StrategyTooltip name="entryThreshold" />
          </span>
          <input type="number" name="entryThreshold" step="any"
            value={merged.entryThreshold} onChange={change}
            placeholder="e.g. 3" className={inpCls} />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Pump Time Window <StrategyTooltip name="priceWindow" />
          </span>
          <div className="relative">
            <select name="priceWindow" value={merged.priceWindow}
              onChange={change} className={`${inpCls} appearance-none pr-10`}>
              <option value="">None</option>
              {priceWins.slice(1).map(w => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* volume filters */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Volume Floor (USD) <StrategyTooltip name="volumeThreshold" />
          </span>
          <input type="number" name="volumeThreshold"
            value={merged.volumeThreshold} onChange={change}
            disabled={disabled} placeholder="e.g. 50000" className={inpCls} />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Volume Time Window <StrategyTooltip name="volumeWindow" />
          </span>
          <div className="relative">
            <select name="volumeWindow" value={merged.volumeWindow}
              onChange={change} disabled={disabled}
              className={`${inpCls} appearance-none pr-10`}>
              <option value="">None</option>
              {volumeWins.slice(1).map(w => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* Turbo & Auto-risk toggles */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="turboMode"
            checked={merged.turboMode} onChange={change} disabled={disabled}/>
          Enable Turbo Sniper Mode <StrategyTooltip name="turboMode" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="autoRiskManage"
            checked={merged.autoRiskManage} onChange={change} disabled={disabled}/>
          Auto Risk Management <StrategyTooltip name="autoRiskManage" />
        </label>
      </div>
      {/* private RPC */}
      <label className="flex flex-col text-sm font-medium gap-1 mt-4">
        <span className="flex items-center gap-1">
          Private RPC URL <StrategyTooltip name="privateRpcUrl" />
        </span>
        <input type="text" name="privateRpcUrl" value={merged.privateRpcUrl}
          onChange={change} disabled={disabled} placeholder="https://..."
          className={inpCls}/>
      </label>

      {/* ── Advanced Sniper flags (restored) ── */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        {/* Ghost */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ghostMode"
            checked={merged.ghostMode} onChange={change} disabled={disabled}
            className="accent-emerald-500"/>
          Ghost Mode (forward to cover)
        </label>
        {merged.ghostMode && (
          <input type="text" name="coverWalletId"
            value={merged.coverWalletId} onChange={change} disabled={disabled}
            placeholder="Cover wallet ID" className={inpCls}/>
        )}
      </div>

      {/* multi-buy */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="multiBuy"
            checked={merged.multiBuy} onChange={change} disabled={disabled}
            className="accent-emerald-500"/>
          Parallel Multi-Buy
        </label>
        {merged.multiBuy && (
          <input type="number" name="multiBuyCount" min="1" max="3"
            value={merged.multiBuyCount} onChange={change} disabled={disabled}
            placeholder="Count (1–3)" className={inpCls}/>
        )}
      </div>

      {/* pre-warm / rug / multi-route */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="prewarmAccounts"
            checked={merged.prewarmAccounts} onChange={change} disabled={disabled}
            className="accent-emerald-500"/>
          Pre-Warm Accounts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoRug"
            checked={merged.autoRug} onChange={change} disabled={disabled}
            className="accent-emerald-500"/>
          Auto Rug Detection
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="multiRoute"
            checked={merged.multiRoute} onChange={change} disabled={disabled}
            className="accent-emerald-500"/>
          Multi-Route Aggregation
        </label>
      </div>

      {/* token feed / advanced sections */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields      config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* summary */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          <span className="text-pink-400 font-semibold">Sniper Summary</span> — List:&nbsp;
          {merged.overrideMonitored
            ? <span className="text-yellow-300 font-semibold">My Monitored</span>
            : <span className="text-emerald-300 font-semibold">
                {feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom"}
              </span>
          }; Pump&nbsp;
          <span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span>&nbsp;
          in <span className="text-indigo-300 font-semibold">{merged.priceWindow}</span>; Volume&nbsp;
          <span className="text-emerald-300 font-semibold">
            ≥ ${(+merged.volumeThreshold).toLocaleString()}
          </span>&nbsp;in&nbsp;
          <span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
          {/* age / market-cap summaries omitted for brevity */}
          { (merged.ghostMode || merged.multiBuy || merged.prewarmAccounts ||
             merged.autoRug   || merged.multiRoute) && (
            <>; Flags&nbsp;
              {merged.ghostMode && <span className="text-emerald-300 font-semibold"> Ghost</span>}
              {merged.multiBuy && <span className="text-indigo-300 font-semibold"> Multi×{merged.multiBuyCount}</span>}
              {merged.prewarmAccounts && <span className="text-pink-300 font-semibold"> Prewarm</span>}
              {merged.autoRug && <span className="text-rose-300 font-semibold"> Rug</span>}
              {merged.multiRoute && <span className="text-yellow-300 font-semibold"> MultiRoute</span>}
            </>
          )}
          {merged.turboMode && <span>; Turbo <span className="text-emerald-300 font-semibold">On</span></span>}
          {merged.autoRiskManage && <span>; AutoRisk <span className="text-emerald-300 font-semibold">On</span></span>}
        </p>
      </div>
    </>
  );
};

export default turboSniperConfig;
