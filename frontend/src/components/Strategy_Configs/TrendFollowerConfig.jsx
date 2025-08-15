// SniperConfig.jsx — Tabbed layout (Core / Execution / Token List / Advanced)
// Solid (non-transparent) backgrounds, darker container, pretty toggle, no “Apply” button

import React, { useMemo, useState } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* feed selector options */
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

/* fields we consider “optional” (used by Advanced / Summary) */
export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "minMarketCap",
  "maxMarketCap",
  "tokenFeed",
  "monitoredTokens",
  "overrideMonitored",
  "useSignals",
  "executionShape",
  "priorityFeeLamports",
];

export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

/* shared UI helpers (solid backgrounds) */
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
      <span className="ml-2 inline-flex items-center justify-center text-[10px] rounded-full px-1.5 py-0.5 bg-red-600 text-white">
        {badge}
      </span>
    )}
  </button>
);

/* tab key mapping for simple validation badges */
const TAB_KEYS = {
  core: [
    "entryThreshold", "priceWindow",
    "volumeThreshold", "volumeWindow",
    "minTokenAgeMinutes", "maxTokenAgeMinutes",
    "minMarketCap", "maxMarketCap",
  ],
  execution: ["useSignals", "executionShape", "priorityFeeLamports"],
  tokens: ["tokenFeed", "monitoredTokens", "overrideMonitored"],
  advanced: [],
};

const validateTrendFollower = (cfg = {}) => {
  const errs = [];
  if (cfg.entryThreshold === "" || cfg.entryThreshold === undefined || Number.isNaN(+cfg.entryThreshold)) {
    errs.push("entryThreshold is required.");
  }
  if (cfg.volumeThreshold === "" || cfg.volumeThreshold === undefined || Number.isNaN(+cfg.volumeThreshold)) {
    errs.push("volumeThreshold is required.");
  }
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0, tokens: 0, advanced: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k.toLowerCase()))).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += (errors.length - categorized);
  return counts;
};

const TrendFollowerConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* sensible defaults */
  const defaults = {
    entryThreshold       : 3,
    volumeThreshold      : 50_000,
    priceWindow          : "1h",
    volumeWindow         : "24h",
    tokenFeed            : "new",
    monitoredTokens      : "",
    overrideMonitored    : false,

    minMarketCap         : "",
    maxMarketCap         : "",
    minTokenAgeMinutes   : "",
    maxTokenAgeMinutes   : "",

    // Execution
    useSignals           : false,
    executionShape       : "",        // "", "TWAP", "ATOMIC"
    priorityFeeLamports  : "",        // μlam (micro-lamports)
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : ["priceWindow", "volumeWindow", "executionShape"].includes(name)
          ? value
          : value === "" ? "" : (isNaN(Number(value)) ? value : parseFloat(value)),
    }));
  };

  /* select options */
  const priceWins  = ["", "1m","5m","15m","30m","1h","2h","4h","6h"];
  const volumeWins = ["", "1m","5m","30m","1h","4h","8h","24h"];

  /* solid field container + transparent inputs */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";

  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  const errors = validateTrendFollower(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* Tabs */
  const CoreTab = () => (
    <Section>
      <Card title="Core Filters" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Pump threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Threshold (%)</span>
              <StrategyTooltip name="entryThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="entryThreshold"
                step="any"
                value={merged.entryThreshold}
                onChange={change}
                placeholder="e.g. 3"
                className={inp}
                disabled={disabled}
              />
            </div>
          </div>

          {/* Pump time window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Time Window</span>
              <StrategyTooltip name="priceWindow" />
            </div>
            <div className={fieldWrap}>
              <select
                name="priceWindow"
                value={merged.priceWindow}
                onChange={change}
                className={`${inp} appearance-none pr-8`}
                disabled={disabled}
              >
                <option value="">None</option>
                {priceWins.slice(1).map((w) => <option key={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
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
                value={merged.volumeThreshold}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 50000"
                className={inp}
              />
            </div>
          </div>

          {/* Volume window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Time Window</span>
              <StrategyTooltip name="volumeWindow" />
            </div>
            <div className={fieldWrap}>
              <select
                name="volumeWindow"
                value={merged.volumeWindow}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="">None</option>
                {volumeWins.slice(1).map((w) => <option key={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
            </div>
          </div>
        </div>

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

  const ExecutionTab = () => (
    <Section>
      <Card title="Signals & Execution Shape">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Toggle signals */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <span>Enable Signals</span>
              <StrategyTooltip name="useSignals" />
            </div>
            <div className={fieldWrap + " flex items-center justify-between px-3 py-2"}>
              <input
                type="checkbox"
                name="useSignals"
                checked={!!merged.useSignals}
                onChange={(e) => change({ target: { name: "useSignals", type: "checkbox", checked: e.target.checked } })}
                disabled={disabled}
                className="accent-emerald-500 w-4 h-4"
              />
              <span className="text-xs text-zinc-400">Backend-derived trend cues</span>
            </div>
          </div>

          {/* Execution shape */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Execution Shape</span>
              <StrategyTooltip name="executionShape" />
            </div>
            <div className={fieldWrap}>
              <select
                name="executionShape"
                value={merged.executionShape ?? ""}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="">Default</option>
                <option value="TWAP">TWAP</option>
                <option value="ATOMIC">Atomic Scalp</option>
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Timing & Fees">
        <div className="grid sm:grid-cols-2 gap-4">
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
    </Section>
  );

  const TokensTab = () => (
    <Section>
      <Card title="Token List" className="sm:col-span-2">
        <TokenSourceSelector config={merged} setConfig={setConfig} disabled={disabled}/>
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields config={merged} setConfig={setConfig} disabled={disabled}/>
        </Card>
      </Section>
      {children}
    </>
  );

  /* Strategy summary helpers */
  const summaryTokenList = merged.overrideMonitored
    ? "📝 My Token List"
    : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");

  /* render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Trend Follower Config</h2>

        {/* Pretty toggle */}
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
          <TabButton active={activeTab==="tokens"} onClick={()=>setActiveTab("tokens")} badge={tabErr.tokens}>Token List</TabButton>
          <TabButton active={activeTab==="advanced"} onClick={()=>setActiveTab("advanced")} badge={tabErr.advanced}>Advanced</TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          📈 Targets tokens trending upward over your chosen windows, filtering out sudden pumps — ideal for catching organic rallies.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core"      && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "tokens"    && <TokensTab />}
        {activeTab === "advanced"  && <AdvancedTab />}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Trend Follower Summary</span> — List:&nbsp;
            <span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;
            &nbsp;Pump <span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.priceWindow}</span>;
            &nbsp;Volume&nbsp;
            <span className="text-emerald-300 font-semibold">
              ≥ ${(+merged.volumeThreshold).toLocaleString()}
            </span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
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
          </p>
        </div>
      </div>

      {/* Sticky Footer (no Apply button) */}
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

export default TrendFollowerConfig;
