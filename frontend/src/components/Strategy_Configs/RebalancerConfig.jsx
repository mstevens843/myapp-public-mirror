// src/components/strategies/RebalancerConfig.jsx
// RebalancerConfig.jsx — hoisted tabs, active-field guard, string-controlled inputs
// - Mirrors the Breakout "golden reference" structure for stable typing
// - All numeric fields are type="text" with inputMode="decimal"
// - onChange → parent receives raw string (or boolean for checkboxes)
// - onBlur   → coerce numeric fields to number | ""
// - Guard against parent overwrites by tracking the active input
//
// Strategy-specific pieces preserved: TargetWeightsBuilder, wallet/token loading, Auto Balance equalize.

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import StrategyTooltip from "./StrategyTooltip";
import TargetWeightsBuilder from "./TargetWeightsBuilder";
import { useUser } from "@/contexts/UserProvider";
import { fetchPortfolio, fetchActiveWallet } from "@/utils/auth";
import { saveConfig } from "@/utils/autobotApi";
import { toast } from "sonner";

// Logging helpers (same instrumentation as Breakout / Rotation / Chad)
import {
  logChange,
  logBlur,
  logEffect,
  logFocus,
  logSelection,
  logRender,
} from "@/dev/inputDebug";

/* ───────────────────── Validation contract ───────────────────── */
export const REQUIRED_FIELDS = [
  "rebalanceThreshold",
  "rebalanceInterval",
  "targetAllocations",
  "maxRebalances",
];
export const OPTIONAL_FIELDS = ["slippage", "priorityFeeLamports", "autoWallet"];

/* numeric fields we edit as raw strings (coerce on blur/save) */
const NUM_FIELDS = [
  "rebalanceThreshold",
  "rebalanceInterval",
  "maxRebalances",
  "slippage",
  "priorityFeeLamports",
];

/* ───────────────────── Shared UI helpers ───────────────────── */
const FIELD_WRAP =
  "relative rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 hover:border-zinc-600 focus-within:border-emerald-500/70 transition";
const INP =
  "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 outline-none border-none focus:outline-none";

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
    className={`relative px-3 sm:px-4 py-2 text-sm transition ${
      active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
    }`}
  >
    <span className="pb-1">{children}</span>
    <span
      className={`absolute left-0 right-0 -bottom-[1px] h-[2px] transition ${
        active ? "bg-emerald-400" : "bg-transparent"
      }`}
    />
    {badge > 0 && (
      <span className="ml-2 inline-flex items-center justify-center text-[10px] rounded-full px-1.5 py-0.5 bg-red-600 text-white">
        {badge}
      </span>
    )}
  </button>
);

/* Tabs -> keys for error badges */
const TAB_KEYS = {
  core: ["rebalanceThreshold", "targetAllocations", "autoWallet"],
  execution: ["rebalanceInterval", "maxRebalances", "slippage", "priorityFeeLamports"],
};

/* ───────────────────────────── Validation ───────────────────────────── */
const validateRebalancer = (cfg = {}) => {
  const errs = [];
  const numAllocs = Object.keys(cfg.targetAllocations ?? {}).length;

  const isBad = (v) => v === "" || v === undefined || Number.isNaN(+v);
  if (isBad(cfg.rebalanceThreshold) || +cfg.rebalanceThreshold <= 0)
    errs.push("rebalanceThreshold must be > 0.");
  if (isBad(cfg.rebalanceInterval) || +cfg.rebalanceInterval <= 0)
    errs.push("rebalanceInterval must be > 0 ms.");
  if (!cfg.autoWallet && numAllocs < 2)
    errs.push("targetAllocations requires at least two tokens (or enable Auto Balance).");
  if (isBad(cfg.maxRebalances) || +cfg.maxRebalances <= 0)
    errs.push("maxRebalances must be ≥ 1.");
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k.toLowerCase()))).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += errors.length - categorized;
  return counts;
};

/* ───────────────────────────── Hoisted Tabs ───────────────────────────── */
const CoreTab = React.memo(function CoreTab({
  view,
  disabled,
  walletTokens,
  tooFewTargets,
  autoEqualize,
  setConfig,
  showRequiredOnly,
}) {
  return (
    <Section>
      <Card title="Core Settings" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Rebalance threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rebalance Threshold (%)</span>
              <StrategyTooltip name="rebalanceThreshold" side="left" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="rebalanceThreshold"
                value={view.rebalanceThreshold ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("rebalanceThreshold")}
                placeholder="e.g. 5"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Auto Balance toggle */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <span>Auto Balance Mode (equal %)</span>
              <StrategyTooltip name="targetWeights" side="left" />
            </div>
            <div className={FIELD_WRAP + " flex items-center px-3 py-2"}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="autoWallet"
                  checked={!!view.autoWallet}
                  onChange={(e) => autoEqualize(e.currentTarget.checked)}
                  disabled={disabled}
                  className="accent-emerald-500 w-4 h-4"
                />
                <span className="text-zinc-300">Equalize current targets</span>
              </label>
            </div>
          </div>
        </div>

        {/* Target allocations builder */}
        {!showRequiredOnly && (
          <div className="mt-4">
            <div className="text-sm font-medium text-zinc-300 mb-1 flex items-center gap-2">
              <span>Target Allocations</span>
              <StrategyTooltip name="targetAllocations" side="left" />
            </div>

            <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2">
              <TargetWeightsBuilder
                targetWeights={view.targetAllocations || {}}
                onUpdate={(updated) =>
                  setConfig((prev) => ({ ...(prev ?? {}), targetAllocations: updated }))
                }
                disabled={disabled}
                autoEqual={view.autoWallet}
                walletTokens={walletTokens}
              />
            </div>

            {tooFewTargets && (
              <p className="text-xs text-red-400 mt-2">
                ➡️ Add at least <strong>two</strong> token mints to start this strategy or enable Auto Balance.
              </p>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
});

const ExecutionTab = React.memo(function ExecutionTab({ view, disabled }) {
  return (
    <Section>
      <Card title="Timing & Limits">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rebalance Interval (ms)</span>
              <StrategyTooltip name="rebalanceInterval" side="left" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="rebalanceInterval"
                value={view.rebalanceInterval ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("rebalanceInterval")}
                placeholder="e.g. 600000"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Max rebalances */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Max Rebalances (#)</span>
              <StrategyTooltip name="maxRebalances" side="left" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="maxRebalances"
                value={view.maxRebalances ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("maxRebalances")}
                placeholder="e.g. 10"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Slippage */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Slippage (%)</span>
              <StrategyTooltip name="slippage" side="left" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="slippage"
                value={view.slippage ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("slippage")}
                placeholder="e.g. 8"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Priority fee */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Priority Fee (μlam)</span>
              <StrategyTooltip name="priorityFeeLamports" side="left" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="priorityFeeLamports"
                value={view.priorityFeeLamports ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("priorityFeeLamports")}
                placeholder="e.g. 1000"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );
});

/* ───────────────────────────── Main Component ───────────────────────────── */
const RebalancerConfig = ({
  config = {},
  setConfig,
  disabled = false,
  onValidityChange,
  mode = "rebalancer",
}) => {
  /* sensible defaults */
  const defaults = {
    walletId: undefined,
    slippage: 8, // %
    rebalanceThreshold: 5, // %
    rebalanceInterval: 600_000, // 10 min in ms
    maxRebalances: 10,
    autoWallet: false,
    targetAllocations: {}, // mint -> weight%
    priorityFeeLamports: "",
  };

  /* Merge defaults with incoming config */
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // Debug flags
  const isDebug =
    typeof window !== "undefined" && localStorage.REBAL_DEBUG === "1";
  const isRawInputMode =
    typeof window !== "undefined" && localStorage.REBAL_RAW_INPUT_MODE === "1";

  // Active-field guard
  const activeFieldRef = useRef(null);
  const clearActiveField = useCallback(() => {
    activeFieldRef.current = null;
    if (typeof window !== "undefined") {
      window.__REBAL_ACTIVE_FIELD = null;
    }
  }, []);

  const handleFocusCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    activeFieldRef.current = name;
    if (typeof window !== "undefined") {
      window.__REBAL_ACTIVE_FIELD = name;
    }
    logFocus({ comp: "RebalancerConfig", field: name });
  }, []);

  const handleBlurCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    if (activeFieldRef.current === name) {
      clearActiveField();
    }
  }, [clearActiveField]);

  const handleSelectCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    const { selectionStart: start, selectionEnd: end } = e.target;
    logSelection({ comp: "RebalancerConfig", field: name, start, end });
  }, []);

  // Log renders
  useEffect(() => {
    logRender({
      comp: "RebalancerConfig",
      fieldSet: Object.keys(merged),
      reason: "render",
    });
  }, [merged]);

  // Generic change handler (string for inputs/selects, boolean for checkboxes)
  const handleChange = useCallback(
    (e) => {
      const { name, type, value, checked } = e.currentTarget;
      const next = type === "checkbox" ? !!checked : value;
      const prevVal = merged[name];
      setConfig((prev) => ({ ...(prev ?? {}), [name]: next }));
      logChange({
        comp: "RebalancerConfig",
        field: name,
        raw: value,
        prev: prevVal,
        next,
      });
    },
    [setConfig, merged]
  );

  // Blur coercion for numeric fields
  const handleBlur = useCallback(
    (field) => (e) => {
      if (!NUM_FIELDS.includes(field)) {
        clearActiveField();
        return;
      }
      const raw = e?.currentTarget?.value ?? "";
      const before = merged[field];
      if (isRawInputMode) {
        clearActiveField();
        return;
      }
      let after;
      if (raw === "") {
        after = "";
      } else {
        const num = Number(raw);
        after = Number.isFinite(num) ? num : "";
      }
      setConfig((prev) => ({ ...(prev ?? {}), [field]: after }));
      logBlur({ comp: "RebalancerConfig", field, before, after });
      clearActiveField();
    },
    [setConfig, merged, isRawInputMode, clearActiveField]
  );

  // View model: numeric values as strings for display
  const view = useMemo(() => {
    const v = { ...merged, handleChange, handleBlur };
    for (const k of NUM_FIELDS) {
      const val = merged[k];
      v[k] = (val === "" || val === null || val === undefined) ? "" : String(val);
    }
    return v;
  }, [merged, handleChange, handleBlur]);

  /* Derived counts */
  const numAllocations = Object.keys(merged.targetAllocations || {}).length;
  const tooFewTargets = !merged.autoWallet && numAllocations < 2;

  /* Propagate validity upwards */
  useEffect(() => {
    if (typeof onValidityChange === "function") {
      onValidityChange(!tooFewTargets);
    }
  }, [tooFewTargets, onValidityChange]);

  /* Wallet & tokens */
  const { activeWallet } = useUser();
  const [walletTokens, setWalletTokens] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTokens() {
      try {
        let walletId = merged?.walletId || activeWallet?.id;
        if (!walletId) {
          walletId = await fetchActiveWallet();
          if (walletId) setConfig((prev) => ({ ...(prev ?? {}), walletId }));
        }
        if (!walletId) return;

        setLoading(true);
        const tokens = await fetchPortfolio(walletId);
        if (!cancelled) setWalletTokens(tokens);
      } catch (err) {
        console.error("❌ Rebalancer loadTokens error:", err);
        toast.error("Failed to load wallet tokens");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadTokens();
    return () => { cancelled = true; };
  }, [merged?.walletId, activeWallet?.id, setConfig]);

  /* Auto equalize when toggled on */
  const autoEqualize = useCallback((checked) => {
    setConfig((prev) => {
      const next = { ...(prev ?? {}), autoWallet: !!checked };
      if (!checked) return next;
      const mints = Object.keys(next.targetAllocations ?? {});
      if (mints.length === 0) return next;
      const equal = +(100 / mints.length).toFixed(2);
      next.targetAllocations = Object.fromEntries(mints.map((m) => [m, equal]));
      return next;
    });
  }, [setConfig]);

  const errors = validateRebalancer(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  // Preset dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");

  const doSavePreset = async () => {
    try {
      const name = (presetName || "").trim();
      // Normalize numeric fields before saving: coerce to numbers when possible
      const patch = {};
      for (const k of NUM_FIELDS) {
        const raw = merged[k];
        if (raw === "" || raw === null || raw === undefined) {
          patch[k] = "";
        } else {
          const num = Number(raw);
          patch[k] = Number.isFinite(num) ? num : "";
        }
      }
      setConfig((prev) => ({ ...(prev ?? {}), ...patch }));
      logEffect({ comp: "RebalancerConfig", reason: "savePreset", touched: patch });
      await saveConfig(mode, { ...merged, ...patch }, name);
      window.dispatchEvent(new CustomEvent("savedConfig:changed", { detail: { mode } }));
      toast.success(name ? `Saved preset “${name}”` : "Preset saved");
      setShowSaveDialog(false);
      setPresetName("");
    } catch (e) {
      toast.error(e?.message || "Failed to save preset");
    }
  };

  // Prevent parent modal close while save dialog open
  useEffect(() => {
    if (showSaveDialog) {
      document.body.dataset.saveOpen = "1";
    } else {
      delete document.body.dataset.saveOpen;
    }
    return () => {
      delete document.body.dataset.saveOpen;
    };
  }, [showSaveDialog]);

  /* Summary helpers */
  const minutes = (ms) => (ms && !Number.isNaN(+ms) ? Math.round(+ms / 60000) : "—");

  /* Render */
  return (
    <div
      className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl"
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onSelectCapture={handleSelectCapture}
    >
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
            Rebalancer Config
            {typeof window !== "undefined" && localStorage.REBAL_DEBUG === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-white">Input Debug ON</span>
            )}
            {typeof window !== "undefined" && localStorage.REBAL_RAW_INPUT_MODE === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-700 text-white">RAW INPUT MODE</span>
            )}
          </h2>

          {/* Required-only toggle */}
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
          <TabButton active={activeTab === "core"} onClick={() => setActiveTab("core")} badge={tabErr.core}>
            Core
          </TabButton>
          <TabButton active={activeTab === "execution"} onClick={() => setActiveTab("execution")} badge={tabErr.execution}>
            Execution
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          ⚖️ Automatically rebalances your portfolio back to target weights when allocations drift — ideal for
          maintaining structured exposure.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core" && (
          <CoreTab
            view={view}
            disabled={disabled}
            walletTokens={walletTokens}
            tooFewTargets={tooFewTargets}
            autoEqualize={autoEqualize}
            setConfig={setConfig}
            showRequiredOnly={showRequiredOnly}
          />
        )}

        {activeTab === "execution" && (
          <ExecutionTab
            view={view}
            disabled={disabled}
          />
        )}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs leading-4">
            <span className="text-pink-400 font-semibold">Rebalance Summary</span> —&nbsp; Threshold{" "}
            <span className="text-emerald-300 font-semibold">≥ {view.rebalanceThreshold || "—"}%</span>; &nbsp;Interval{" "}
            <span className="text-emerald-300 font-semibold">{minutes(view.rebalanceInterval)} min</span>; &nbsp;Max{" "}
            <span className="text-emerald-300 font-semibold">{view.maxRebalances || "—"}</span> cycles; &nbsp;Slippage{" "}
            <span className="text-emerald-300 font-semibold">{view.slippage || "—"}%</span>; &nbsp;Targets{" "}
            <span className="text-indigo-300 font-semibold">
              {view.autoWallet ? "Auto" : `${numAllocations} assets`}
            </span>
            {view.priorityFeeLamports ? (
              <>; CU fee <span className="text-yellow-300 font-semibold">{view.priorityFeeLamports} μlam</span></>
            ) : null}
          </p>
        </div>

        {/* Helper link */}
        <div className="mt-2">
          <a
            href="https://birdeye.so/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:underline"
          >
            🔍 Open Birdeye
          </a>
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
              onClick={() => {
                const reset = { ...defaults };
                setConfig((prev) => ({ ...(prev ?? {}), ...reset }));
                logEffect({ comp: "RebalancerConfig", reason: "reset", touched: reset });
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
            className="fixed z-50 top-1/2 left-1/2 w-[380px] -translate-x-1/2 -translate-y-1/2
                       rounded-xl border border-zinc-800 bg-zinc-950/95
                       p-5 text-zinc-200 shadow-2xl focus:outline-none
                       data-[state=open]:animate-scaleIn"
          >
            {/* Header */}
            <div className="relative mb-4">
              <Dialog.Title className="text-sm font-semibold text-white text-center">Save Config Preset</Dialog.Title>
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

            {/* Input */}
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.currentTarget.value)}
              placeholder="Preset name (optional)…"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2
                         text-sm text-white placeholder:text-zinc-500
                         focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            {/* Footer */}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-md border border-zinc-800
                             bg-zinc-900 hover:bg-zinc-800 text-zinc-200"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={doSavePreset}
                className="px-3 py-1.5 text-xs rounded-md bg-emerald-600
                           hover:bg-emerald-500 text-black font-semibold"
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

export default RebalancerConfig;
