// ScalperConfig.jsx — Tabbed layout (Core / Execution / Token List / Advanced)
// Draft-only editing (no keystroke updates to parent).
// Summary only recomputes on dropdown toggle or Apply/Save.

import React, { useMemo, useEffect, useState } from "react";
import StrategyTooltip from "./StrategyTooltip";
import TokenSourceSelector, { feedOptions as FEEDS } from "./TokenSourceSelector";
import AdvancedFields from "../ui/AdvancedFields";
import { ChevronDown } from "lucide-react";

/* required by validator */
export const REQUIRED_FIELDS = [
  "entryThreshold",
  "priceWindow",
  "volumeThreshold",
  "volumeWindow",
];

export const OPTIONAL_FIELDS = [
  "volumeSpikeMultiplier",
  "tokenFeed",
  "monitoredTokens",
  "overrideMonitored",
  "minMarketCap",
  "maxMarketCap",
  "useSignals",
  "executionShape",
  "priorityFeeLamports",
  "mevMode",
  "briberyAmount",
];

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
    "entryThreshold",
    "priceWindow",
    "volumeThreshold",
    "volumeWindow",
    "volumeSpikeMultiplier",
    "minMarketCap",
    "maxMarketCap",
  ],
  execution: ["useSignals", "executionShape", "priorityFeeLamports", "mevMode", "briberyAmount"],
  tokens: ["tokenFeed", "monitoredTokens", "overrideMonitored"],
  advanced: [],
};

const validateScalperConfig = (cfg = {}, priceWins = [], volumeWins = []) => {
  const errs = [];
  if (cfg.entryThreshold === "" || cfg.entryThreshold === undefined || Number.isNaN(+cfg.entryThreshold)) {
    errs.push("entryThreshold is required.");
  }
  if (cfg.volumeThreshold === "" || cfg.volumeThreshold === undefined || Number.isNaN(+cfg.volumeThreshold)) {
    errs.push("volumeThreshold is required.");
  }
  if (!cfg.priceWindow || !priceWins.includes(cfg.priceWindow)) {
    errs.push("priceWindow is required.");
  }
  if (!cfg.volumeWindow || !volumeWins.includes(cfg.volumeWindow)) {
    errs.push("volumeWindow is required.");
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

/* helpers for parsing/pretty */
const safeNum = (v) => {
  const s = (v ?? "").toString().replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const pretty = (v) => {
  const n = safeNum(v);
  return n === null ? (v ?? "") : n.toLocaleString();
};

/* Build an aggregated object and a human-readable summary
   NOTE: This does NOT mutate original fields; it adds _derived + strategySummary. */
const buildAggregated = (d) => {
  const list = d.overrideMonitored
    ? "📝 My Token List"
    : FEEDS.find((f) => f.value === d.tokenFeed)?.label || "Custom";

  const entryThresholdPct = safeNum(d.entryThreshold);
  const volumeThresholdUSD = safeNum(d.volumeThreshold);
  const minMC = safeNum(d.minMarketCap);
  const maxMC = safeNum(d.maxMarketCap);
  const spike = safeNum(d.volumeSpikeMultiplier);
  const priorityFee = safeNum(d.priorityFeeLamports);
  const briberyAmt = safeNum(d.briberyAmount);

  const summaryText = [
    `List: ${list}`,
    `Pump ≥ ${entryThresholdPct ?? d.entryThreshold}% in ${d.priceWindow}`,
    `Volume ≥ $${pretty(d.volumeThreshold)} in ${d.volumeWindow}`,
    spike ? `Spike × ${spike}` : null,
    minMC || maxMC
      ? `MC ${minMC ? `≥ $${pretty(minMC)}` : ""}${
          minMC && maxMC ? " / " : ""
        }${maxMC ? `≤ $${pretty(maxMC)}` : ""}`
      : null,
    d.executionShape ? `Exec: ${d.executionShape}` : null,
    d.mevMode ? `MEV: ${d.mevMode}` : null,
    priorityFee ? `PriorityFee: ${priorityFee} μlam` : null,
    briberyAmt ? `Bribe: ${briberyAmt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    ...d,
    _derived: {
      entryThresholdPct,
      volumeThresholdUSD,
      minMarketCapUSD: minMC,
      maxMarketCapUSD: maxMC,
      spike,
      priorityFeeLamportsNum: priorityFee,
      briberyAmountNum: briberyAmt,
    },
    strategySummary: summaryText,
  };
};

const ScalperConfig = ({
  config = {},
  setConfig,             // parent setter — called ONLY on Apply / SavePreset
  disabled,
  children,
  onSavePreset,          // optional callback(finalAggregated)
}) => {
  /* defaults */
  const defaults = {
    // Core
    entryThreshold: 1,
    priceWindow: "5m",
    volumeThreshold: 500,
    volumeWindow: "5m",
    volumeSpikeMultiplier: "",
    minMarketCap: "",
    maxMarketCap: "",
    tokenFeed: "trending",
    monitoredTokens: "",
    overrideMonitored: false,

    // Execution
    useSignals: false,
    executionShape: "", // "", "TWAP", "ATOMIC"
    priorityFeeLamports: "", // μlam
    mevMode: "fast", // or "secure"
    briberyAmount: 0.0, // SOL or lamports label—left as-is
  };

  // Merge incoming config with defaults (stable base)
  const mergedIncoming = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // 🔒 LOCAL DRAFT STATE — inputs bind to this only.
  const [draft, setDraft] = useState(mergedIncoming);

  // Keep draft in sync when parent config changes (e.g. loading a preset)
useEffect(() => {
  setDraft({ ...defaults, ...(config ?? {}) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [config]);

  /* options (tight for scalper) */
  const priceWins = ["1m", "5m"];
  const volumeWins = ["1m", "5m"];

  /* Prevent stale window values when coming from other strategies – local only */
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d };
      if (!priceWins.includes(next.priceWindow)) next.priceWindow = defaults.priceWindow;
      if (!volumeWins.includes(next.volumeWindow)) next.volumeWindow = defaults.volumeWindow;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local change helpers (no parent updates)
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setDraft((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // Coerce numeric-looking strings on blur (strip commas; empty -> "")
  const coerceNumberOnBlur = (name) => (e) => {
    const raw = (e.target.value ?? "").trim();
    if (raw === "") {
      setDraft((p) => ({ ...p, [name]: "" }));
      return;
    }
    const num = Number(String(raw).replace(/,/g, ""));
    const normalized = Number.isFinite(num) ? String(num) : raw;
    setDraft((p) => ({ ...p, [name]: normalized }));
  };

  // Provide a setConfig-compatible setter for child components (kept local)
  const setDraftCompat = (update) => {
    if (typeof update === "function") {
      setDraft((prev) => update(prev));
    } else {
      setDraft((prev) => ({ ...prev, ...(update || {}) }));
    }
  };

  /* solid field container + transparent inputs */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";

  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  // Validate the *draft*
  const errors = validateScalperConfig(draft, priceWins, volumeWins);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  // Collapsible Summary state + snapshot (so it DOES NOT change while typing)
  const [showSummary, setShowSummary] = useState(false);
  const [summarySnapshot, setSummarySnapshot] = useState(null);

  const openOrCloseSummary = () => {
    setShowSummary((prev) => {
      const next = !prev;
      if (next) {
        // Compute snapshot ONLY when opening
        setSummarySnapshot(buildAggregated(draft));
      }
      return next;
    });
  };

  /* Tabs */
  const CoreTab = () => (
    <Section>
      <Card title="Core Filters" className="sm:col-span-2">
        {/* Required row */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Entry threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Entry Threshold (%)</span>
              <StrategyTooltip name="entryThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="numeric"
                name="entryThreshold"
                value={draft.entryThreshold ?? ""}
                onChange={change}
                onBlur={coerceNumberOnBlur("entryThreshold")}
                disabled={disabled}
                placeholder="e.g. 0.5"
                className={inp}
              />
            </div>
          </div>

          {/* Pump window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Window</span>
              <StrategyTooltip name="priceWindow" />
            </div>
            <div className={fieldWrap}>
              <select
                name="priceWindow"
                value={draft.priceWindow ?? ""}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                {priceWins.map((w) => (
                  <option key={w}>{w}</option>
                ))}
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
                type="text"
                inputMode="numeric"
                name="volumeThreshold"
                value={draft.volumeThreshold ?? ""}
                onChange={change}
                onBlur={coerceNumberOnBlur("volumeThreshold")}
                disabled={disabled}
                placeholder="e.g. 500"
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
            <div className={fieldWrap}>
              <select
                name="volumeWindow"
                value={draft.volumeWindow ?? ""}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                {volumeWins.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Optional area — MC 50/50 on one row, Volume Spike full-width at bottom */}
        {!showRequiredOnly && (
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {/* Min Market Cap */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Min Market Cap (USD)</span>
                <StrategyTooltip name="minMarketCap" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="numeric"
                  name="minMarketCap"
                  value={draft.minMarketCap ?? ""}
                  onChange={change}
                  onBlur={coerceNumberOnBlur("minMarketCap")}
                  disabled={disabled}
                  placeholder="e.g. 1,000,000"
                  className={inp}
                />
              </div>
            </div>

            {/* Max Market Cap */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Max Market Cap (USD)</span>
                <StrategyTooltip name="maxMarketCap" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="numeric"
                  name="maxMarketCap"
                  value={draft.maxMarketCap ?? ""}
                  onChange={change}
                  onBlur={coerceNumberOnBlur("maxMarketCap")}
                  disabled={disabled}
                  placeholder="e.g. 10,000,000"
                  className={inp}
                />
              </div>
            </div>

            {/* Volume spike — bottom, spans two inputs */}
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Volume Spike ×</span>
                <StrategyTooltip name="volumeSpikeMultiplier" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="numeric"
                  name="volumeSpikeMultiplier"
                  value={draft.volumeSpikeMultiplier ?? ""}
                  onChange={change}
                  onBlur={coerceNumberOnBlur("volumeSpikeMultiplier")}
                  disabled={disabled}
                  placeholder="e.g. 2"
                  className={inp}
                />
              </div>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );

  const ExecutionTab = () => (
    <Section>
      {/* TOP-LEFT: Signals & Execution Shape (vertical) */}
      <Card title="Signals & Execution Shape">
        <div className="flex flex-col gap-4">
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
                checked={!!draft.useSignals}
                onChange={(e) =>
                  change({ target: { name: "useSignals", type: "checkbox", checked: e.target.checked } })
                }
                disabled={disabled}
                className="accent-emerald-500 w-4 h-4"
              />
              <span className="text-xs text-zinc-400">Backend-derived momentum cues</span>
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
                value={draft.executionShape ?? ""}
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

      {/* TOP-RIGHT: MEV (vertical) */}
      <Card title="MEV Preferences">
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>MEV Mode</span>
              <StrategyTooltip name="mevMode" />
            </div>
            <div className={fieldWrap}>
              <select
                name="mevMode"
                value={draft.mevMode ?? ""}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="fast">fast</option>
                <option value="secure">secure</option>
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Bribery (Lamports)</span>
              <StrategyTooltip name="briberyAmount" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="numeric"
                name="briberyAmount"
                value={draft.briberyAmount ?? ""}
                onChange={change}
                onBlur={coerceNumberOnBlur("briberyAmount")}
                disabled={disabled}
                placeholder="e.g. 0.002"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* SECOND ROW, LEFT: Timing (vertical) */}
      <Card title="Timing & Fees" className="sm:col-span-1">
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Priority Fee (μlam)</span>
              <StrategyTooltip name="priorityFeeLamports" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="numeric"
                name="priorityFeeLamports"
                value={draft.priorityFeeLamports ?? ""}
                onChange={change}
                onBlur={coerceNumberOnBlur("priorityFeeLamports")}
                disabled={disabled}
                placeholder="e.g. 20000"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>
      {/* RIGHT slot left empty intentionally */}
    </Section>
  );

  const TokensTab = () => (
    <Section>
      <Card title="Token List" className="sm:col-span-2">
        <TokenSourceSelector config={draft} setConfig={setDraftCompat} disabled={disabled} />
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields config={draft} setConfig={setDraftCompat} disabled={disabled} />
        </Card>
      </Section>
      {children}
    </>
  );

  // Actions
  const handleResetVisible = () => {
    setDraft((prev) => ({ ...defaults, ...(prev ?? {}) }));
    // If summary is open, refresh snapshot after reset so it reflects defaults
    if (showSummary) setSummarySnapshot(buildAggregated({ ...defaults }));
  };

  const handleApply = () => {
    const finalCfg = buildAggregated(draft); // aggregate ON APPLY
    if (typeof setConfig === "function") {
      // Shallow merge into parent so we don't drop unknown keys the parent might hold
      setConfig((prev) => ({ ...(prev || {}), ...(finalCfg || {}) }));
    }
    // If summary is open, refresh snapshot to reflect committed values
    if (showSummary) setSummarySnapshot(finalCfg);
  };

  const handleSavePreset = () => {
    const finalCfg = buildAggregated(draft); // aggregate ON SAVE
    if (typeof onSavePreset === "function") {
      onSavePreset(finalCfg);
    } else {
      console.log("💾 Save Preset (aggregated):", finalCfg);
    }
    if (showSummary) setSummarySnapshot(finalCfg);
  };

  /* render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Scalper Config</h2>

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
          <TabButton active={activeTab === "core"} onClick={() => setActiveTab("core")} badge={tabErr.core}>
            Core
          </TabButton>
          <TabButton active={activeTab === "execution"} onClick={() => setActiveTab("execution")} badge={tabErr.execution}>
            Execution
          </TabButton>
          <TabButton active={activeTab === "tokens"} onClick={() => setActiveTab("tokens")} badge={tabErr.tokens}>
            Token List
          </TabButton>
          <TabButton active={activeTab === "advanced"} onClick={() => setActiveTab("advanced")} badge={tabErr.advanced}>
            Advanced
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          ⚡ Rapidly scalps top-trending tokens using ultra-fast 1m/5m momentum signals.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {activeTab === "core" && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "tokens" && <TokensTab />}
        {activeTab === "advanced" && <AdvancedTab />}

        {/* Collapsible Strategy Summary (snapshot-based) */}
        <div className="mt-6 bg-zinc-900 rounded-md border border-zinc-800">
          <button
            type="button"
            onClick={openOrCloseSummary}
            aria-expanded={showSummary}
            aria-controls="scalper-summary"
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-200 hover:text-white"
            title="Show/hide summary"
          >
            <span className="font-semibold">Scalper Summary</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showSummary ? "rotate-180" : ""}`}
            />
          </button>

          {showSummary && summarySnapshot && (
            <div id="scalper-summary" className="border-t border-zinc-800 p-3">
              <p className="text-xs text-right leading-4">
                <span className="text-pink-400 font-semibold">Scalper Summary</span> —{" "}
                <span className="text-zinc-200">{summarySnapshot.strategySummary}</span>
              </p>
            </div>
          )}
          {showSummary && !summarySnapshot && (
            <div id="scalper-summary" className="border-t border-zinc-800 p-3">
              <p className="text-xs text-right leading-4 text-zinc-400">No data.</p>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">
                ⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}
              </span>
            ) : (
              <span className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]">Ready</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetVisible}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Reset visible values to defaults (non-destructive merge)"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-emerald-600/60 hover:border-emerald-500 text-emerald-300"
              title="Apply draft to parent config (aggregate on click)"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Save preset (aggregated on click)"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScalperConfig;
