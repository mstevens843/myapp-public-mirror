// SniperConfig.jsx  ✨ now includes a Strategy Summary card
import React, { useMemo } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import AdvancedSection     from "../ui/AdvancedSection";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

/* fields we consider “optional” (surfaced in Advanced / Summary) ------- */
export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  // "dipWindow", 
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "minMarketCap",
  "maxMarketCap",
  "tokenFeed",
  "monitoredTokens",
  "overrideMonitored",
];

const SniperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* —— sensible defaults —— */
  const defaults = {
    entryThreshold    : 3,
    volumeThreshold   : 50_000,
    priceWindow       : "1h",
    volumeWindow      : "24h",
    tokenFeed         : "new",
    monitoredTokens   : "",
    overrideMonitored : false,
    minMarketCap      : "",
    maxMarketCap      : "",
    dipThreshold      : "",
    delayBeforeBuyMs  : "",
    priorityFeeLamports: "",
      // 🆕 MEV prefs DOMT FORGET ABOUT THIS
    mevMode: "fast",          // or "secure"
    briberyAmount: 0.002,     // default bribe in SOL
  };
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* —— change handlers —— */
const change = (e) => {
  const { name, value, type, checked } = e.target;

  setConfig((prev) => ({
    ...prev,
    [name]:
      type === "checkbox"
        ? checked
        : ["priceWindow", "volumeWindow", "recoveryWindow"].includes(name)
        ? value
        : value === "" ? "" : parseFloat(value),
  }));
};


  /* —— select options —— */
const priceWins    = ["", "1m","5m","15m","30m","1h","2h","4h","6h"];
const volumeWins   = ["", "1m","5m","30m","1h","4h","8h","24h"];
// const recoveryWins = ["", "1m", "5m", "15m", "30m", "1h"];

  

  /* —— shared input cls —— */
  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  /* ============================================================= */
  return (
    <>
{/* ——— strategy description ——— */}
<div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-3">
  🔫 This strategy hunts early-stage listings, letting you tune price &amp; volume
  windows, token age, and more to precision-snipe brand-new or trending tokens.
</div>

{/* ——— Price & Volume thresholds ——— */}
<div className="grid sm:grid-cols-2 gap-4">
  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Pump Threshold (%) <StrategyTooltip name="entryThreshold" />
    </span>
    <input
      type="number"
      name="entryThreshold"
      step="any"
      value={merged.entryThreshold}
      onChange={change}
      // disabled={disabled || merged.dipThreshold > 0}
      placeholder="e.g. 3"
      className={inp}
    />
  </label>

  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Pump Time Window <StrategyTooltip name="priceWindow" />
    </span>
    <div className="relative">
      <select
        name="priceWindow"
        value={merged.priceWindow}
        onChange={change}
        // disabled={disabled || merged.dipThreshold > 0}
        className={`${inp} appearance-none pr-10`}
      >
        <option value="">None</option>
        {priceWins.slice(1).map((w) => <option key={w}>{w}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
    </div>
  </label>
</div>

{/* ——— Volume filters ——— */}
<div className="grid sm:grid-cols-2 gap-4 mt-4">
  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Volume Floor (USD) <StrategyTooltip name="volumeThreshold" />
    </span>
    <input
      type="number"
      name="volumeThreshold"
      value={merged.volumeThreshold}
      onChange={change}
      disabled={disabled}
      placeholder="e.g. 50000"
      className={inp}
    />
  </label>

  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Volume Time Window <StrategyTooltip name="volumeWindow" />
    </span>
    <div className="relative">
      <select
        name="volumeWindow"
        value={merged.volumeWindow}
        onChange={change}
        disabled={disabled}
        className={`${inp} appearance-none pr-10`}
      >
        <option value="">None</option>
        {volumeWins.slice(1).map((w) => <option key={w}>{w}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
    </div>
  </label>
</div>

{/* ——— Dip Threshold & Recovery ——— */}
{/* <div className="grid sm:grid-cols-2 gap-4 mt-4">
  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Dip Threshold (%) <StrategyTooltip name="dipThreshold" />
    </span>
    <input
      type="number"
      name="dipThreshold"
      step="any"
      value={merged.dipThreshold}
      onChange={change}
      disabled={disabled || merged.entryThreshold > 0}
      placeholder="e.g. -5"
      className={inp}
    />
  </label>

  <label className="flex flex-col text-sm font-medium gap-1">
    <span className="flex items-center gap-1">
      Recovery Window <StrategyTooltip name="recoveryWindow" />
    </span>
    <div className="relative">
      <select
        name="recoveryWindow"
        value={merged.recoveryWindow}
        onChange={change}
        disabled={disabled || merged.entryThreshold > 0}
        className={`${inp} appearance-none pr-10`}
      >
        <option value="">—</option>
        {recoveryWins.slice(1).map((w) => <option key={w}>{w}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
    </div>
  </label>
</div> */}

{/* ——— Token Age (min/max) ——— */}
<div className="grid sm:grid-cols-2 gap-4 mt-4">
  {["min","max"].map((k) => (
    <label key={k} className="flex flex-col text-sm font-medium gap-1">
      <span className="flex items-center gap-1">
        {k === "min" ? "Min" : "Max"} Token Age (min)
        <StrategyTooltip name={`${k}TokenAgeMinutes`} />
      </span>
      <input
        type="number"
        name={`${k}TokenAgeMinutes`}
        value={merged[`${k}TokenAgeMinutes`] ?? ""}
        onChange={change}
        disabled={disabled}
        placeholder="e.g. 60"
        className={inp}
      />
    </label>
  ))}
</div>

{/* ——— Delay Before Buy (standalone) ——— */}
{/* <label className="flex flex-col text-sm font-medium gap-1 mt-4">
  <span className="flex items-center gap-1">
    Delay Before Buy (ms) <StrategyTooltip name="delayBeforeBuyMs" />
  </span>
  <input
    type="number"
    name="delayBeforeBuyMs"
    value={merged.delayBeforeBuyMs}
    onChange={change}
    disabled={disabled}
    placeholder="e.g. 5000"
    className={inp}
  />
</label> */}

      {/* ——— Token feed selector, Advanced, children ——— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* ——————————————————————————————————————————————— */}
      {/*  📊 STRATEGY SUMMARY  (only shows filled values)           */}
      {/* ——————————————————————————————————————————————— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
  <p className="text-xs text-right leading-4">
    📊 <span className="text-pink-400 font-semibold">Sniper Summary</span> — 
    List:&nbsp;
    {merged.overrideMonitored ? (
      <span className="text-yellow-300 font-semibold">📝 My Monitored</span>
    ) : (
      <span className="text-emerald-300 font-semibold">
        {feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom"}
      </span>
    )};&nbsp;
    Pump&nbsp;<span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span>&nbsp;
    in&nbsp;<span className="text-indigo-300 font-semibold">{merged.priceWindow}</span>;
    Volume&nbsp;<span className="text-emerald-300 font-semibold">
      ≥ ${(+merged.volumeThreshold).toLocaleString()}
    </span>&nbsp;in&nbsp;
    <span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
    {merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes ? (
      <>; Age&nbsp;
        {merged.minTokenAgeMinutes && (
          <>≥ <span className="text-rose-300 font-semibold">{merged.minTokenAgeMinutes}m</span></>
        )}
        {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
        {merged.maxTokenAgeMinutes && (
          <>≤ <span className="text-rose-300 font-semibold">{merged.maxTokenAgeMinutes}m</span></>
        )}
      </>
    ) : null}
    {merged.minMarketCap || merged.maxMarketCap ? (
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
      </>
    ) : null}
  </p>
</div>
    </>
  );
};

export default SniperConfig;
