import React, { useMemo, useState, useCallback, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import StrategyTooltip from "./StrategyTooltip";
import TokenSourceSelector, { feedOptions as FEEDS } from "./TokenSourceSelector";
import AdvancedFields from "../ui/AdvancedFields";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { saveConfig } from "@/utils/autobotApi";

export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  "volumeSpikeMultiplier",
  "minLiquidity",
  "monitoredTokens",
  "overrideMonitored",
  "useSignals",
  "executionShape",
  "delayBeforeBuyMs",
  "priorityFeeLamports",
  "mevMode",
  "briberyAmount",
];

export const REQUIRED_FIELDS = ["breakoutThreshold", "volumeThreshold"];

// numeric fields we edit as raw strings (no coercion until blur/save)
const NUM_FIELDS = [
  "breakoutThreshold",
  "volumeThreshold",
  "volumeSpikeMultiplier",
  "minLiquidity",
  "delayBeforeBuyMs",
  "priorityFeeLamports",
  "briberyAmount",
];

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
    type="button"
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

const TAB_KEYS = {
  core: [
    "breakoutThreshold", "priceWindow",
    "volumeThreshold", "volumeWindow",
    "minLiquidity", "volumeSpikeMultiplier",
  ],
  execution: ["useSignals", "executionShape", "delayBeforeBuyMs", "priorityFeeLamports", "mevMode", "briberyAmount"],
  tokens: ["tokenFeed", "monitoredTokens", "overrideMonitored"],
  advanced: [],
};

const validateBreakoutConfig = (cfg = {}) => {
  const errs = [];
  if (cfg.breakoutThreshold === "" || cfg.breakoutThreshold === undefined || Number.isNaN(+cfg.breakoutThreshold)) {
    errs.push("breakoutThreshold is required.");
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

const BreakoutConfig = ({
  config = {},
  setConfig,
  disabled,
  children,
  mode = "breakout",
}) => {
  const defaults = {
    // Core
    breakoutThreshold     : 5,
    priceWindow           : "30m",
    volumeThreshold       : 100_000,
    volumeWindow          : "1h",
    volumeSpikeMultiplier : 2.5,
    minLiquidity          : "",
    tokenFeed             : "trending",
    monitoredTokens       : "",
    overrideMonitored     : false,

    // Execution
    useSignals            : false,
    executionShape        : "",
    delayBeforeBuyMs      : "",
    priorityFeeLamports   : "",
    mevMode               : "fast",
    briberyAmount         : 0.0,
  };

  // base config coming from parent
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // ---------- LOCAL DRAFT STATE ----------
  const initDraftFrom = useCallback((src) => {
    const next = {};
    for (const k of NUM_FIELDS) {
      const v = src?.[k];
      next[k] = (v === "" || v === null || v === undefined) ? "" : String(v);
    }
    return next;
  }, []);

  const [draft, setDraft] = useState(() => initDraftFrom(merged));

  // When parent config changes externally (open/reset/preset load), resync draft.
  useEffect(() => {
    setDraft(initDraftFrom(merged));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initDraftFrom, merged.breakoutThreshold, merged.volumeThreshold, merged.volumeSpikeMultiplier, merged.minLiquidity, merged.delayBeforeBuyMs, merged.priorityFeeLamports, merged.briberyAmount]);

  // View model: show draft values for numeric fields; everything else from merged.
  const view = useMemo(() => {
    return { ...merged, ...draft };
  }, [merged, draft]);
  // ---------------------------------------

  // For non-numeric fields we can write through immediately.
  const setField = useCallback((name, raw, type, checked) => {
    if (type === "checkbox") {
      setConfig((prev) => ({ ...(prev || {}), [name]: !!checked }));
      return;
    }
    // If it's one of our numeric fields, keep it in local draft only (no parent write yet).
    if (NUM_FIELDS.includes(name)) {
      setDraft((d) => ({ ...d, [name]: raw }));
    } else {
      setConfig((prev) => ({ ...(prev || {}), [name]: raw }));
    }
  }, [setConfig]);

  // On blur for numeric inputs: parse and push to parent; keep draft as typed.
  const coerceNumberOnBlur = (name) => (e) => {
    const raw = e?.currentTarget?.value ?? "";
    if (raw === "") {
      setConfig((prev) => ({ ...(prev || {}), [name]: "" }));
      return;
    }
    const num = Number(raw);
    setConfig((prev) => ({ ...(prev || {}), [name]: Number.isFinite(num) ? num : "" }));
  };

  const priceWins  = ["", "30m","1h","2h","4h"];
  const volumeWins = ["", "30m","1h","2h","4h","8h"];

  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-600 focus-within:border-emerald-500/70 transition";
  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  const errors = validateBreakoutConfig(view);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  // Save Preset dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");

  const doSavePreset = async () => {
    try {
      const name = (presetName || "").trim();
      // Push current draft into parent before save to ensure numbers are parsed
      const patch = {};
      for (const k of NUM_FIELDS) {
        const raw = draft[k];
        if (raw === "" || raw === null || raw === undefined) patch[k] = "";
        else {
          const num = Number(raw);
          patch[k] = Number.isFinite(num) ? num : "";
        }
      }
      setConfig((prev) => ({ ...(prev || {}), ...patch }));

      await saveConfig(mode, { ...merged, ...patch }, name);
      window.dispatchEvent(new CustomEvent("savedConfig:changed", { detail: { mode } }));
      toast.success(name ? `Saved preset “${name}”` : "Preset saved");
      setShowSaveDialog(false);
      setPresetName("");
    } catch (e) {
      toast.error(e?.message || "Failed to save preset");
    }
  };

  // Flag for parent modal to suppress close while the save dialog is open
  useEffect(() => {
    if (showSaveDialog) {
      document.body.dataset.saveOpen = "1";
    } else {
      delete document.body.dataset.saveOpen;
    }
    return () => { delete document.body.dataset.saveOpen; };
  }, [showSaveDialog]);

  const CoreTab = () => (
    <Section>
      <Card title="Core Filters" className="sm:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Pump threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Threshold (%)</span>
              <StrategyTooltip name="breakoutThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="decimal"
                name="breakoutThreshold"
                value={view.breakoutThreshold ?? ""}
                onChange={(e) =>
                  setField("breakoutThreshold", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
                onBlur={coerceNumberOnBlur("breakoutThreshold")}
                placeholder="e.g. 5"
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
                value={view.priceWindow}
                onChange={(e) => setField("priceWindow", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)}
                className={`${inp} appearance-none pr-8`}
                disabled={disabled}
              >
                <option value="">None</option>
                {priceWins.map((w) => <option key={w} value={w}>{w}</option>)}
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
                type="text"
                inputMode="decimal"
                name="volumeThreshold"
                value={view.volumeThreshold ?? ""}
                onChange={(e) =>
                  setField("volumeThreshold", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
                onBlur={coerceNumberOnBlur("volumeThreshold")}
                disabled={disabled}
                placeholder="e.g. 100000"
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
                value={view.volumeWindow}
                onChange={(e) => setField("volumeWindow", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="">None</option>
                {volumeWins.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
            </div>
          </div>
        </div>

        {!showRequiredOnly && (
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {/* Volume spike */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Volume Spike ×</span>
                <StrategyTooltip name="volumeSpikeMultiplier" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="volumeSpikeMultiplier"
                  value={view.volumeSpikeMultiplier ?? ""}
                  onChange={(e) =>
                    setField("volumeSpikeMultiplier", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                  }
                  onBlur={coerceNumberOnBlur("volumeSpikeMultiplier")}
                  disabled={disabled}
                  placeholder="e.g. 2"
                  className={inp}
                />
              </div>
            </div>

            {/* Min liquidity */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Min Liquidity (USD)</span>
                <StrategyTooltip name="minLiquidity" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="minLiquidity"
                  value={view.minLiquidity ?? ""}
                  onChange={(e) =>
                    setField("minLiquidity", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                  }
                  onBlur={coerceNumberOnBlur("minLiquidity")}
                  disabled={disabled}
                  placeholder="e.g. 200000"
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
      <Card title="Timing & Fees">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Delay Before Buy (ms)</span>
              <StrategyTooltip name="delayBeforeBuyMs" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="decimal"
                name="delayBeforeBuyMs"
                value={view.delayBeforeBuyMs ?? ""}
                onChange={(e) =>
                  setField("delayBeforeBuyMs", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
                onBlur={coerceNumberOnBlur("delayBeforeBuyMs")}
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
                type="text"
                inputMode="decimal"
                name="priorityFeeLamports"
                value={view.priorityFeeLamports ?? ""}
                onChange={(e) =>
                  setField("priorityFeeLamports", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
                onBlur={coerceNumberOnBlur("priorityFeeLamports")}
                disabled={disabled}
                placeholder="e.g. 20000"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Signals & Execution Shape">
        <div className="grid gap-4">
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
                checked={!!view.useSignals}
                onChange={(e) =>
                  setField("useSignals", e.currentTarget.value, "checkbox", e.currentTarget.checked)
                }
                disabled={disabled}
                className="accent-emerald-500 h-4 w-4"
              />
              <span className="text-xs text-zinc-400">
                Backend-derived momentum cues
              </span>
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
                value={view.executionShape ?? ""}
                onChange={(e) =>
                  setField("executionShape", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
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

      <Card title="MEV Preferences">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>MEV Mode</span>
              <StrategyTooltip name="mevMode" />
            </div>
            <div className={fieldWrap}>
              <select
                name="mevMode"
                value={view.mevMode}
                onChange={(e) => setField("mevMode", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)}
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
              <span>Bribery (SOL)</span>
              <StrategyTooltip name="briberyAmount" />
            </div>
            <div className={fieldWrap}>
              <input
                type="text"
                inputMode="decimal"
                name="briberyAmount"
                value={view.briberyAmount ?? ""}
                onChange={(e) =>
                  setField("briberyAmount", e.currentTarget.value, e.currentTarget.type, e.currentTarget.checked)
                }
                onBlur={coerceNumberOnBlur("briberyAmount")}
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

  const TokensTab = () => (
    <Section>
      <Card title="Token List" className="sm:col-span-2">
        {/* Pass through parent setConfig so selector can write immediately */}
        <TokenSourceSelector config={view} setConfig={setConfig} disabled={disabled}/>
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields config={view} setConfig={setConfig} disabled={disabled}/>
        </Card>
      </Section>
      {children}
    </>
  );

  const summaryTokenList = view.overrideMonitored
    ? "📝 My Token List"
    : (FEEDS.find(f => f.value === view.tokenFeed)?.label || "Custom");

  return (
    <div
      className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl focus:outline-none"
    >
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000 focus:outline-none">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Breakout Config</h2>

        <label className="flex items-center gap-3 select-none">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={showRequiredOnly}
              onChange={(e) => setShowRequiredOnly(e.currentTarget.checked)}
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
      <div className="p-4 sm:p-5" data-inside-dialog="1">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          🚀 Detects sudden price/volume break-outs on monitored or feed-selected tokens and enters early.
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
            <span className="text-pink-400 font-semibold">Breakout Summary</span> — List:&nbsp;
            <span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;
            &nbsp;Pump <span className="text-emerald-300 font-semibold">≥ {view.breakoutThreshold}%</span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{view.priceWindow || "30m"}</span>;
            &nbsp;Volume&nbsp;
            <span className="text-emerald-300 font-semibold">
              ≥ ${(+view.volumeThreshold || 0).toLocaleString()}
            </span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{view.volumeWindow || "1h"}</span>
            {view.volumeSpikeMultiplier && (
              <>; Spike × <span className="text-yellow-300 font-semibold">{view.volumeSpikeMultiplier}</span></>
            )}
            {view.minLiquidity && (
              <>; LP ≥ <span className="text-orange-300 font-semibold">
                ${(+view.minLiquidity || 0).toLocaleString()}
              </span></>
            )}
          </p>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl" data-inside-dialog="1">
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
              onClick={() => {
                // reset BOTH parent config and local draft
                const reset = { ...defaults };
                setConfig((prev) => ({ ...(prev ?? {}), ...reset }));
                setDraft(initDraftFrom(reset));
              }}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Reset this section to defaults"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setShowSaveDialog(true)}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>

      {/* Save Preset Dialog (Radix) */}
      <Dialog.Root open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fadeIn" />
          <Dialog.Content
            className="fixed z-50 top-1/2 left-1/2 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-white shadow-2xl focus:outline-none data-[state=open]:animate-scaleIn"
          >
            <div className="relative">
              <Dialog.Title className="text-sm font-semibold text-white mb-3 text-center">
                Save Config Preset
              </Dialog.Title>

              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute top-2 right-2 p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.currentTarget.value)}
              placeholder="Preset name (optional)…"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              // No Enter/Escape handlers: Save is click-only as requested
            />

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-white"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={doSavePreset}
                className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 hover:bg-emerald-500 text-black font-semibold"
              >
                Save
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default BreakoutConfig;
