// src/components/strategies/ChadModeConfig.jsx
// ChadModeConfig.jsx — hoisted tabs, active-field guard, string-controlled inputs
// - Inputs live directly inside hoisted tab components (no remount on render)
// - All numeric fields are type="text" with inputMode="decimal"
// - onChange: parent receives raw string (or boolean for checkboxes)
// - onBlur: coerce to number if finite else ""
// - Guard against parent overwrites by tracking active field at module scope
//
// This mirrors the Breakout "golden reference" structure for stable typing.

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import StrategyTooltip from "./StrategyTooltip";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { saveConfig } from "@/utils/autobotApi";

// Logging helpers (debug ring buffer, same as Breakout)
import {
  logChange,
  logBlur,
  logEffect,
  logFocus,
  logSelection,
  logRender,
} from "@/dev/inputDebug";

/* ───────────────────── Validation contract ───────────────────── */
export const REQUIRED_FIELDS = ["outputMint"];

export const OPTIONAL_FIELDS = [
  "useMultiTargets",
  "targetTokens",
  "minVolumeRequired",
  "slippage",
  "priorityFeeLamports",
  "autoSell",
  "panicDumpPct",
  "slippageMaxPct",
  "feeEscalationLamports",
  "ignoreSafetyChecks",
  "useSignals",
  "executionShape",
];

/* numeric fields we edit as raw strings (coerce on blur/save) */
const NUM_FIELDS = [
  "slippage",
  "priorityFeeLamports",
  "minVolumeRequired",
  "panicDumpPct",
  "slippageMaxPct",
  "feeEscalationLamports",
  "autoSell.delay",
  "autoSell.dumpPct",
  "autoSell.randomJitterMs",
];

/* ───────────────────── Shared UI helpers (module scope) ───────────────────── */
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

const Section = ({ children, oneCol = false }) => (
  <div className={`grid gap-4 md:gap-5 ${oneCol ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>{children}</div>
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
  core: ["outputMint", "targetTokens", "useMultiTargets", "minVolumeRequired", "slippage"],
  execution: ["priorityFeeLamports", "autoSell.delay", "autoSell.dumpPct", "autoSell.randomJitterMs"],
  advanced: ["panicDumpPct", "slippageMaxPct", "feeEscalationLamports", "ignoreSafetyChecks", "useSignals", "executionShape"],
};

/* ───────────────────────────── Validation ───────────────────────────── */
const isMint = (s = "") => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

const validateChad = (cfg = {}) => {
  const errs = [];

  if (cfg.useMultiTargets) {
    const list = String(cfg.targetTokens || "")
      .split(/\s+/)
      .filter(Boolean);
    if (list.length === 0) errs.push("targetTokens must include at least one mint.");
    if (list.length > 0 && !list.every(isMint)) errs.push("targetTokens include an invalid mint address.");
  } else {
    if (!cfg.outputMint || !isMint(cfg.outputMint)) errs.push("outputMint must be a valid mint.");
  }

  if (cfg.slippage !== "" && cfg.slippage != null && (Number.isNaN(+cfg.slippage) || +cfg.slippage <= 0)) {
    errs.push("slippage must be > 0%.");
  }
  if (
    cfg.priorityFeeLamports !== "" &&
    cfg.priorityFeeLamports != null &&
    (Number.isNaN(+cfg.priorityFeeLamports) || +cfg.priorityFeeLamports < 0)
  ) {
    errs.push("priorityFeeLamports must be ≥ 0 μlam.");
  }
  if (
    cfg.autoSell?.delay !== undefined &&
    cfg.autoSell?.delay !== "" &&
    (Number.isNaN(+cfg.autoSell.delay) || +cfg.autoSell.delay < 0)
  ) {
    errs.push("autoSell.delay must be ≥ 0 ms.");
  }
  if (
    cfg.autoSell?.dumpPct !== undefined &&
    cfg.autoSell?.dumpPct !== "" &&
    (Number.isNaN(+cfg.autoSell.dumpPct) || +cfg.autoSell.dumpPct < 0 || +cfg.autoSell.dumpPct > 100)
  ) {
    errs.push("autoSell.dumpPct must be between 0 and 100.");
  }
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0, advanced: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k.toLowerCase()))).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += errors.length - categorized;
  return counts;
};

/* ───────────── helpers for nested (autoSell.*) field access ───────────── */
const getNested = (obj, path) => {
  if (!path.includes(".")) return obj[path];
  const [root, key] = path.split(".");
  return (obj?.[root] || {})[key];
};

const setNested = (obj, path, value) => {
  if (!path.includes(".")) {
    obj[path] = value;
    return obj;
  }
  const [root, key] = path.split(".");
  obj[root] = { ...(obj[root] ?? {}) };
  obj[root][key] = value;
  return obj;
};

/* ───────────────────── Hoisted Tab Components ───────────────────── */
const CoreTab = React.memo(function CoreTab({ view, disabled, handleChange, handleBlur }) {
  return (
    <Section>
      <Card title="Target(s)" className="sm:col-span-2">
        <div className="grid gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Target Mint (outputMint)</span>
                <StrategyTooltip name="outputMint" side="left" />
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  name="useMultiTargets"
                  checked={!!view.useMultiTargets}
                  onChange={handleChange}
                  disabled={disabled}
                  className="accent-emerald-500 w-3 h-3"
                />
                Multi-Targets
                <StrategyTooltip name="targetTokens" side="left" />
              </label>
            </div>

            {!view.useMultiTargets ? (
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  name="outputMint"
                  value={view.outputMint ?? ""}
                  onChange={handleChange}
                  placeholder="Ex: 9n4nbM…"
                  disabled={disabled}
                  className={INP}
                />
              </div>
            ) : (
              <div className={FIELD_WRAP}>
                <textarea
                  name="targetTokens"
                  rows={2}
                  value={view.targetTokens ?? ""}
                  onChange={handleChange}
                  placeholder="Paste mint addresses — whitespace/newline separated"
                  disabled={disabled}
                  className={`${INP} resize-y`}
                />
              </div>
            )}
          </div>

          {!view.__showRequiredOnly && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Min Liquidity (USD)</span>
                  <StrategyTooltip name="minVolumeRequired" side="left" />
                </div>
                <div className={FIELD_WRAP}>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="minVolumeRequired"
                    value={view.minVolumeRequired ?? ""}
                    onChange={handleChange}
                    onBlur={handleBlur("minVolumeRequired")}
                    placeholder="e.g. 8000"
                    disabled={disabled}
                    className={INP}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Base Slippage (%)</span>
                  <StrategyTooltip name="slippage" side="left" />
                </div>
                <div className={FIELD_WRAP}>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="slippage"
                    value={view.slippage ?? ""}
                    onChange={handleChange}
                    onBlur={handleBlur("slippage")}
                    placeholder="e.g. 5"
                    disabled={disabled}
                    className={INP}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Safety: full width switch */}
      <Card title="Safety" className="sm:col-span-2">
        <div className={`${FIELD_WRAP} w-full flex items-center gap-2 px-3 py-2`}>
          <input
            type="checkbox"
            name="ignoreSafetyChecks"
            checked={!!view.ignoreSafetyChecks}
            onChange={handleChange}
            disabled={disabled}
            className="accent-red-500 w-4 h-4"
          />
          <span className="flex items-center gap-1 text-sm text-red-400">
            Skip Safety Checks (⚠️ YOLO)
            <StrategyTooltip name="skipSafetyChecks" side="left" />
          </span>
        </div>
      </Card>
    </Section>
  );
});

const ExecutionTab = React.memo(function ExecutionTab({ view, disabled, handleChange, handleBlur }) {
  return (
    <Section>
      {/* Left: Timing & Fees */}
      <Card title="Timing & Fees">
        <div className="grid gap-4">
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
                onChange={handleChange}
                onBlur={handleBlur("priorityFeeLamports")}
                placeholder="e.g. 10000"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {!view.__showRequiredOnly && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Slippage Ceiling (%)</span>
                  <StrategyTooltip name="slippageMaxPct" side="left" />
                </div>
                <div className={FIELD_WRAP}>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="slippageMaxPct"
                    value={view.slippageMaxPct ?? ""}
                    onChange={handleChange}
                    onBlur={handleBlur("slippageMaxPct")}
                    placeholder="e.g. 10"
                    disabled={disabled}
                    className={INP}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Fee Escalation (μlam)</span>
                  <StrategyTooltip name="feeEscalationLamports" side="left" />
                </div>
                <div className={FIELD_WRAP}>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="feeEscalationLamports"
                    value={view.feeEscalationLamports ?? ""}
                    onChange={handleChange}
                    onBlur={handleBlur("feeEscalationLamports")}
                    placeholder="e.g. 5000"
                    disabled={disabled}
                    className={INP}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Right: Auto-Dump */}
      <Card title="Auto-Dump">
        <div className="grid gap-4">
          <div className={`${FIELD_WRAP} w-full flex items-center gap-2 px-3 py-2`}>
            <input
              type="checkbox"
              name="autoSell.enabled"
              checked={!!(view.autoSell?.enabled ?? true)}
              onChange={handleChange}
              disabled={disabled}
              className="accent-emerald-500 w-4 h-4"
            />
            <span className="text-sm">Auto-Dump Enabled</span>
            <StrategyTooltip name="autoSell.enabled" side="left" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Delay (ms) before Dump</span>
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="autoSell.delay"
                value={view.autoSell?.delay ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("autoSell.delay")}
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Dump % of Bag</span>
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="autoSell.dumpPct"
                value={view.autoSell?.dumpPct ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("autoSell.dumpPct")}
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {!view.__showRequiredOnly && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Random Jitter (ms)</span>
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="autoSell.randomJitterMs"
                  value={view.autoSell?.randomJitterMs ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("autoSell.randomJitterMs")}
                  disabled={disabled}
                  className={INP}
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
});

const AdvancedTab = React.memo(function AdvancedTab({ view, disabled, handleChange }) {
  return (
    <Section>
      <Card title="Signals & Shape">
        <div className="grid gap-4">
          <div className={`${FIELD_WRAP} w-full flex items-center gap-2 px-3 py-2`}>
            <input
              type="checkbox"
              name="useSignals"
              checked={!!view.useSignals}
              onChange={handleChange}
              disabled={disabled}
              className="accent-emerald-500 w-4 h-4"
            />
            <span className="flex items-center gap-1 text-sm">
              Enable Signals <StrategyTooltip name="useSignals" side="left" />
            </span>
          </div>

          <label className="flex flex-col text-sm font-medium">
            <span className="flex items-center gap-1">
              Execution Shape <StrategyTooltip name="executionShape" side="left" />
            </span>
            <div className={FIELD_WRAP + " mt-1"}>
              <select
                name="executionShape"
                value={view.executionShape ?? ""}
                onChange={handleChange}
                disabled={disabled}
                className={`${INP} appearance-none pr-8`}
              >
                <option value="">Default</option>
                <option value="TWAP">TWAP</option>
                <option value="ATOMIC">Atomic Scalp</option>
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </label>
        </div>
      </Card>

      <Card title="Risk Controls">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Panic-Dump % (drop)</span>
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="panicDumpPct"
                value={view.panicDumpPct ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("panicDumpPct")}
                placeholder="e.g. 15"
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

/* ───────────────────── Main Component ───────────────────── */
const ChadModeConfig = ({ config = {}, setConfig, disabled, mode = "chad" }) => {
  /* sensible defaults */
  const defaults = {
    slippage: 5,
    priorityFeeLamports: 10_000, // μlam
    autoSell: { enabled: true, delay: 10_000, dumpPct: 100, randomJitterMs: 0 },
    useMultiTargets: false,
    targetTokens: "",
    useSignals: false,
    executionShape: "",
    minVolumeRequired: "",
    panicDumpPct: "",
    slippageMaxPct: "",
    feeEscalationLamports: "",
    ignoreSafetyChecks: false,
    outputMint: "",
  };

  // Merge defaults with incoming config
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // Debug flags
  const isDebug =
    typeof window !== "undefined" && localStorage.CHAD_DEBUG === "1";
  const isRawInputMode =
    typeof window !== "undefined" && localStorage.CHAD_RAW_INPUT_MODE === "1";

  // Active-field guard
  const activeFieldRef = useRef(null);
  const clearActiveField = useCallback(() => {
    activeFieldRef.current = null;
    if (typeof window !== "undefined") {
      window.__CHAD_ACTIVE_FIELD = null;
    }
  }, []);

  const handleFocusCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    activeFieldRef.current = name;
    if (typeof window !== "undefined") {
      window.__CHAD_ACTIVE_FIELD = name;
    }
    logFocus({ comp: "ChadModeConfig", field: name });
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
    logSelection({ comp: "ChadModeConfig", field: name, start, end });
  }, []);

  // Log renders for debugging
  useEffect(() => {
    logRender({
      comp: "ChadModeConfig",
      fieldSet: Object.keys(merged),
      reason: "render",
    });
  }, [merged]);

  // Change handler: write raw values to parent (booleans for checkboxes)
  const handleChange = useCallback(
    (e) => {
      const { name, type, value, checked } = e.currentTarget;
      let next;
      if (type === "checkbox") {
        next = !!checked;
      } else {
        next = value;
      }
      const prevVal = getNested(merged, name);
      setConfig((prevConfig) => {
        const updated = { ...(prevConfig ?? {}) };
        setNested(updated, name, next);
        return updated;
      });
      logChange({
        comp: "ChadModeConfig",
        field: name,
        raw: value,
        prev: prevVal,
        next,
      });
    },
    [setConfig, merged]
  );

  // Blur handler: coerce numeric fields only
  const handleBlur = useCallback(
    (field) => (e) => {
      if (!NUM_FIELDS.includes(field)) {
        clearActiveField();
        return;
      }
      const raw = e?.currentTarget?.value ?? "";
      const before = getNested(merged, field);
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
      setConfig((prevConfig) => {
        const updated = { ...(prevConfig ?? {}) };
        setNested(updated, field, after);
        return updated;
      });
      logBlur({ comp: "ChadModeConfig", field, before, after });
      clearActiveField();
    },
    [setConfig, merged, isRawInputMode, clearActiveField]
  );

  // Build a view model (numeric values as strings for display)
  const view = useMemo(() => {
    const v = { ...merged };
    for (const k of NUM_FIELDS) {
      const val = getNested(merged, k);
      const str = (val === "" || val === null || val === undefined) ? "" : String(val);
      setNested(v, k, str);
    }
    return v;
  }, [merged]);

  const errors = validateChad(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  // expose showRequiredOnly into view for tabs
  const viewForTabs = useMemo(() => ({ ...view, __showRequiredOnly: showRequiredOnly }), [view, showRequiredOnly]);

  // Preset dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");

  const doSavePreset = async () => {
    try {
      const name = (presetName || "").trim();
      // Normalize numeric fields before saving: coerce to numbers when possible
      const patch = {};
      for (const k of NUM_FIELDS) {
        const raw = getNested(merged, k);
        let coerced = "";
        if (raw !== "" && raw !== null && raw !== undefined) {
          const num = Number(raw);
          coerced = Number.isFinite(num) ? num : "";
        }
        setNested(patch, k, coerced);
      }
      setConfig((prev) => ({ ...(prev ?? {}), ...patch, autoSell: { ...(prev?.autoSell ?? {}), ...(patch.autoSell ?? {}) } }));
      logEffect({
        comp: "ChadModeConfig",
        reason: "savePreset",
        touched: patch,
      });
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

  /* summary */
  const Summary = () => (
    <div className="mt-6 bg-zinc-900 rounded-md p-3">
      <p className="text-xs text-right leading-4">
        <span className="text-pink-400 font-semibold">Chad Summary</span> — 🪙{" "}
        <span className="text-emerald-300 font-semibold">
          {view.useMultiTargets ? "Multiple Mints" : view.outputMint || "—"}
        </span>
        ; Slip <span className="text-emerald-300 font-semibold">{view.slippage ?? "—"}%</span>
        {view.slippageMaxPct && (
          <>
            →<span className="text-emerald-300 font-semibold">{view.slippageMaxPct}%</span>
          </>
        )}
        ; Fee{" "}
        <span className="text-yellow-300 font-semibold">{view.priorityFeeLamports ?? "—"} μlam</span>
        {view.feeEscalationLamports && (
          <>
            →+<span className="text-yellow-300 font-semibold">{view.feeEscalationLamports}</span>
          </>
        )}
        {view.autoSell?.enabled && (
          <>
            ; 🚀 Dump{" "}
            <span className="text-emerald-300 font-semibold">{view.autoSell.dumpPct ?? ""}%</span> in{" "}
            <span className="text-yellow-300 font-semibold">{view.autoSell.delay ?? ""} ms</span>
          </>
        )}
        {view.panicDumpPct && <>; ☠ {view.panicDumpPct}%</>}
        {view.ignoreSafetyChecks && (
          <>
            ; <span className="text-red-400 font-semibold">⚠️ No Safety</span>
          </>
        )}
      </p>
    </div>
  );

  /* render */
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
            Chad Mode Config
            {typeof window !== "undefined" && localStorage.CHAD_DEBUG === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-white">Input Debug ON</span>
            )}
            {typeof window !== "undefined" && localStorage.CHAD_RAW_INPUT_MODE === "1" && (
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
          <TabButton active={activeTab === "advanced"} onClick={() => setActiveTab("advanced")} badge={tabErr.advanced}>
            Advanced
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          🟥 Ultra high-risk mode: YOLO into a target with aggressive slippage, priority fees, optional safety skips,
          and auto-dumps — tuned for fast pumps & hard exits.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {activeTab === "core" && (
          <CoreTab
            view={viewForTabs}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
          />
        )}
        {activeTab === "execution" && (
          <ExecutionTab
            view={viewForTabs}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
          />
        )}
        {activeTab === "advanced" && (
          <AdvancedTab
            view={view}
            disabled={disabled}
            handleChange={handleChange}
          />
        )}

        <Summary />
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
                logEffect({ comp: "ChadModeConfig", reason: "reset", touched: reset });
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

export default ChadModeConfig;
