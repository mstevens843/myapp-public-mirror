// DipBuyerConfig.jsx — Turbo-style tabbed layout (Core / Execution / Advanced)
// Updated to match SniperConfig styling & UX (pretty toggle, solid cards,
// field wrappers, no “Apply” button)

import React, { useMemo, useState } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* Required fields for basic validation */
export const REQUIRED_FIELDS = ["dipThreshold", "recoveryWindow", "volumeThreshold", "volumeWindow"];

/* Optional (for surface/summary) — mirrors Sniper */
export const OPTIONAL_FIELDS = [
  "recoveryWindow", "volumeWindow",
  "minTokenAgeMinutes", "maxTokenAgeMinutes",
  "minMarketCap", "maxMarketCap",
  "tokenFeed", "monitoredTokens", "overrideMonitored",
  // execution extras (parity with Sniper)
  "delayBeforeBuyMs", "priorityFeeLamports", "mevMode", "briberyAmount",
];

/* feed selector options (summary only) */
const feedOptions = [
  { value: "new",       label: "New listings" },
  { value: "trending",  label: "Trending tokens" },
  { value: "high-liquidity", label: "High Liquidity" },
  { value: "mid-cap-growth", label: "Mid-Cap Growth" },
  { value: "price-surge", label: "Price Surge" },
  { value: "volume-spike", label: "Volume Spike" },
  { value: "high-trade", label: "High Trade Count" },
  { value: "recent-good-liquidity", label: "Recently Listed + Liquidity" },
  { value: "all",       label: "All tokens (premium)" },
  { value: "monitored", label: "My Monitored" },
];

/* Small UI helpers (shared look with Sniper) */
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

const Section = ({ children }) => (
  <div className="grid gap-4 md:gap-5 sm:grid-cols-2">{children}</div>
);

const TabButton = ({ active, onClick, children, badge }) => (
  <button
    onClick={onClick}
    className={`relative px-3 sm:px-4 py-2 text-sm transition
      ${active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
  >
    <span className="pb-1">{children}</span>
    <span
      className={`absolute left-0 right-0 -bottom-[1px] h-[2px] transition
        ${active ? "bg-emerald-400" : "bg-transparent"}`}
    />
    {badge > 0 && (
      <span className="ml-2 inline-flex items-center justify-center text-[10px] rounded-full px-1.5 py-0.5 bg-red-600/80 text-white">
        {badge}
      </span>
    )}
  </button>
);

/* Map errors to tabs for badge counts */
const TAB_KEYS = {
  core: [
    "dipthreshold", "recoverywindow",
    "volumethreshold", "volumewindow",
    "mintokenageminutes", "maxtokenageminutes",
    "minmarketcap", "maxmarketcap",
  ],
  execution: ["delaybeforebuyms", "priorityfeelamports", "mevmode", "briberyamount"],
  advanced: ["tokenfeed", "monitoredtokens", "overridemonitored"],
};

const validateDipBuyerConfig = (cfg = {}) => {
  const errs = [];
  if (cfg.dipThreshold === "" || cfg.dipThreshold === undefined || Number.isNaN(+cfg.dipThreshold)) {
    errs.push("dipThreshold is required.");
  }
  if (!cfg.recoveryWindow) errs.push("recoveryWindow is required.");
  if (cfg.volumeThreshold === "" || cfg.volumeThreshold === undefined || Number.isNaN(+cfg.volumeThreshold)) {
    errs.push("volumeThreshold is required.");
  }
  if (!cfg.volumeWindow) errs.push("volumeWindow is required.");
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0, advanced: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k))).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += (errors.length - categorized);
  return counts;
};

const DipBuyerConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* defaults (merged non-destructively) */
  const defaults = {
    dipThreshold        : 5,
    recoveryWindow      : "5m",
    volumeThreshold     : 10_000,
    volumeWindow        : "1h",
    tokenFeed           : "new",
    monitoredTokens     : "",
    overrideMonitored   : false,

    minMarketCap        : "",
    maxMarketCap        : "",
    minTokenAgeMinutes  : "",
    maxTokenAgeMinutes  : "",

    // Execution (Sniper parity)
    delayBeforeBuyMs    : "",
    priorityFeeLamports : "",
    mevMode             : "fast",
    briberyAmount       : 0.002,
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* options */
  const recoveryWindows = ["1m", "5m", "30m"];
  const volumeWindows   = ["30m", "1h", "2h", "4h"];

  /* Change handler (matches Sniper’s coercion) */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : ["recoveryWindow", "volumeWindow", "mevMode"].includes(name)
          ? value
          : value === "" ? "" : (isNaN(Number(value)) ? value : parseFloat(value)),
    }));
  };

  /* Sniper-style solid field wrap + transparent inputs */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";

  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  /* validation + tab badges */
  const errors = validateDipBuyerConfig(merged);
  const tabErr = countErrorsForTab(errors);

  /* local ui */
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* ---------- Tabs ---------- */
  const CoreTab = () => (
    <Section>
      {/* Full-width card so inputs stretch, like Sniper */}
      <Card title="Core Filters" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Dip threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Dip Threshold (% Drop)</span>
              <StrategyTooltip name="dipThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="dipThreshold"
                step="any"
                value={merged.dipThreshold}
                onChange={change}
                placeholder="e.g. 5"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Recovery window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Recovery Window</span>
              <StrategyTooltip name="recoveryWindow" />
            </div>
            <div className={fieldWrap + " relative"}>
              <select
                name="recoveryWindow"
                value={merged.recoveryWindow}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                {recoveryWindows.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          {/* Volume floor */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Floor (USD)</span>
              <StrategyTooltip name="volumeThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="volumeThreshold"
                step="any"
                value={merged.volumeThreshold}
                onChange={change}
                placeholder="e.g. 10000"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Volume window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Window</span>
              <StrategyTooltip name="volumeWindow" />
            </div>
            <div className={fieldWrap + " relative"}>
              <select
                name="volumeWindow"
                value={merged.volumeWindow}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                {volumeWindows.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Optional filters hidden when "Required only" */}
        {!showRequiredOnly && (
          <>
            {/* Token age */}
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              {["min","max"].map((k) => (
                <div key={k} className="space-y-1">
                  <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                    <span>{k === "min" ? "Min" : "Max"} Token Age (min)</span>
                    <StrategyTooltip name={`${k}TokenAgeMinutes`} />
                  </div>
                  <div className={fieldWrap}>
                    <input
                      type="number"
                      name={`${k}TokenAgeMinutes`}
                      value={merged[`${k}TokenAgeMinutes`] ?? ""}
                      onChange={change}
                      disabled={disabled}
                      placeholder="e.g. 60"
                      className={inp}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Market cap */}
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Min Market Cap (USD)</span>
                  <StrategyTooltip name="minMarketCap" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="minMarketCap"
                    value={merged.minMarketCap ?? ""}
                    onChange={change}
                    disabled={disabled}
                    placeholder="e.g. 1000000"
                    className={inp}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Max Market Cap (USD)</span>
                  <StrategyTooltip name="maxMarketCap" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="maxMarketCap"
                    value={merged.maxMarketCap ?? ""}
                    onChange={change}
                    disabled={disabled}
                    placeholder="e.g. 10000000"
                    className={inp}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </Section>
  );

  /* --------- New: Execution tab (Sniper parity) ---------
     Two 50/50 cards; each stacks its inputs vertically, full width */
  const ExecutionTab = () => (
    <Section>
      {/* Left card */}
      <Card title="Timing & Fees">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Delay Before Buy (ms)</span>
              <StrategyTooltip name="delayBeforeBuyMs" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="delayBeforeBuyMs"
                value={merged.delayBeforeBuyMs}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 5000"
                className={inp}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Priority Fee (μlam)</span>
              <StrategyTooltip name="priorityFeeLamports" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="priorityFeeLamports"
                value={merged.priorityFeeLamports}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 20000"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Right card */}
      <Card title="MEV Preferences">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>MEV Mode</span>
              <StrategyTooltip name="mevMode" />
            </div>
            <div className={fieldWrap + " relative"}>
              <select
                name="mevMode"
                value={merged.mevMode}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="fast">fast</option>
                <option value="secure">secure</option>
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Bribery Lamports</span>
              <StrategyTooltip name="briberyAmount" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                step="0.0001"
                name="briberyAmount"
                value={merged.briberyAmount}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 0.002"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        {/* Full width advanced block (Sniper parity) */}
        <Card title="Token Feeds & Advanced" className="sm:col-span-2">
          <TokenSourceSelector config={merged} setConfig={setConfig} disabled={disabled}/>
          <div className="mt-4">
            <AdvancedFields config={merged} setConfig={setConfig} disabled={disabled}/>
          </div>
        </Card>
      </Section>
      {children}
    </>
  );

  /* ============================ RENDER ============================ */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs (Sniper parity) */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Dip Buyer Config</h2>

          {/* Pretty toggle (like Sniper) */}
          <label className="flex items-center gap-3 select-none">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={showRequiredOnly}
              onChange={(e) => setShowRequiredOnly(e.target.checked)}
            />
            <span className="relative inline-flex h-5 w-9 rounded-full bg-zinc-700 transition-colors peer-checked:bg-emerald-500">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs sm:text-sm text-zinc-300">Required only</span>
          </label>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 relative">
          <TabButton active={activeTab==="core"} onClick={()=>setActiveTab("core")} badge={tabErr.core}>Core</TabButton>
          <TabButton active={activeTab==="execution"} onClick={()=>setActiveTab("execution")} badge={tabErr.execution}>Execution</TabButton>
          <TabButton active={activeTab==="advanced"} onClick={()=>setActiveTab("advanced")} badge={tabErr.advanced}>Advanced</TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        {/* Description ribbon (Sniper style) */}
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          💧 This strategy waits for sharp dips, then buys recovering tokens once they bounce — ideal for catching quick rebounds after a flush.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core"      && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "advanced"  && <AdvancedTab />}

        {/* Strategy Summary (Sniper style) */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Dip Summary</span> — List:&nbsp;
            {merged.overrideMonitored
              ? <span className="text-yellow-300 font-semibold">📝 My Monitored</span>
              : <span className="text-emerald-300 font-semibold">
                  {feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom"}
                </span>
            };&nbsp;
            Dip <span className="text-emerald-300 font-semibold">≥ {merged.dipThreshold}%</span>;
            &nbsp;Recovery <span className="text-indigo-300 font-semibold">{merged.recoveryWindow}</span>;
            &nbsp;Volume <span className="text-emerald-300 font-semibold">
              ≥ ${(+merged.volumeThreshold).toLocaleString()}
            </span> in <span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
            {(merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes) ? (
              <>; Age&nbsp;
                {merged.minTokenAgeMinutes && (<>≥ <span className="text-rose-300 font-semibold">{merged.minTokenAgeMinutes}m</span></>)}
                {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
                {merged.maxTokenAgeMinutes && (<>≤ <span className="text-rose-300 font-semibold">{merged.maxTokenAgeMinutes}m</span></>)}
              </>
            ) : null}
            {(merged.minMarketCap || merged.maxMarketCap) ? (
              <>; MC&nbsp;
                {merged.minMarketCap && (<>≥ <span className="text-orange-300 font-semibold">
                  ${(+merged.minMarketCap).toLocaleString()}
                </span></>)}
                {merged.minMarketCap && merged.maxMarketCap && " / "}
                {merged.maxMarketCap && (<>≤ <span className="text-orange-300 font-semibold">
                  ${(+merged.maxMarketCap).toLocaleString()}
                </span></>)}
              </>
            ) : null}
            {(merged.priorityFeeLamports || merged.mevMode || merged.briberyAmount) ? (
              <>; Exec&nbsp;
                {merged.priorityFeeLamports && (<>CU <span className="text-yellow-300 font-semibold">{merged.priorityFeeLamports}</span> μlam</>)}
                {merged.mevMode && (<> · MEV <span className="text-indigo-300 font-semibold">{merged.mevMode}</span></>)}
                {merged.briberyAmount !== "" && (<> · Bribe <span className="text-emerald-300 font-semibold">{merged.briberyAmount}</span></>)}
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* Sticky Footer (Sniper parity — no Apply) */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">
                ⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}
              </span>
            ) : (
              <span className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]">
                Ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...defaults, ...(prev ?? {}) }))}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Reset visible values to defaults (non-destructive merge)"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {/* keep for parity */}}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DipBuyerConfig;
