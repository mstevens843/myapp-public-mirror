// ChadModeConfig.jsx — Sniper-style tabbed layout (Core / Execution / Advanced)
// Solid (non-transparent) backgrounds, darker container, pretty toggle, no “Apply” button

import React, { useMemo, useState } from "react";
import StrategyTooltip from "./StrategyTooltip";
import { ChevronDown } from "lucide-react";

/* Validation contract */
export const REQUIRED_FIELDS = ["outputMint"];

/* Optional (for summary/advanced surfacing) */
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

/* ────────────────── Shared UI helpers (solid backgrounds) ────────────────── */
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

/* Tabs -> keys for error badges */
const TAB_KEYS = {
  core: ["outputMint", "targetTokens", "useMultiTargets", "minVolumeRequired", "slippage"],
  execution: ["priorityFeeLamports", "autoSell.delay", "autoSell.dumpPct", "autoSell.randomJitterMs"],
  advanced: [
    "panicDumpPct",
    "slippageMaxPct",
    "feeEscalationLamports",
    "ignoreSafetyChecks",
    "useSignals",
    "executionShape",
  ],
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

/* ───────────────────────────── Component ───────────────────────────── */
const ChadModeConfig = ({ config = {}, setConfig, disabled }) => {
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
  const merged = useMemo(() => ({ ...defaults, ...config }), [config]);

  /* shared styles */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";
  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  /* handlers */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith("autoSell.")) {
      const key = name.split(".")[1];
      setConfig((p) => ({
        ...p,
        autoSell: {
          ...(p.autoSell ?? {}),
          [key]: type === "checkbox" ? checked : value === "" ? "" : +value,
        },
      }));
      return;
    }
    setConfig((p) => ({
      ...p,
      [name]:
        type === "checkbox"
          ? checked
          : ["executionShape", "targetTokens", "outputMint"].includes(name)
          ? value
          : value === ""
          ? ""
          : +value,
    }));
  };

  /* validation + badges */
  const errors = validateChad(merged);
  const tabErr = countErrorsForTab(errors);

  /* tabs */
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* Tabs */
  const CoreTab = () => (
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
                  checked={!!merged.useMultiTargets}
                  onChange={change}
                  disabled={disabled}
                  className="accent-emerald-500 w-3 h-3"
                />
                Multi-Targets
                <StrategyTooltip name="targetTokens" side="left" />
              </label>
            </div>

            {!merged.useMultiTargets ? (
              <div className={fieldWrap}>
                <input
                  type="text"
                  name="outputMint"
                  value={merged.outputMint ?? ""}
                  onChange={change}
                  placeholder="Ex: 9n4nbM…"
                  disabled={disabled}
                  className={inp}
                />
              </div>
            ) : (
              <div className={fieldWrap}>
                <textarea
                  name="targetTokens"
                  rows={2}
                  value={merged.targetTokens ?? ""}
                  onChange={change}
                  placeholder="Paste mint addresses — whitespace/newline separated"
                  disabled={disabled}
                  className={`${inp} resize-y`}
                />
              </div>
            )}
          </div>

          {!showRequiredOnly && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Min Liquidity (USD)</span>
                  <StrategyTooltip name="minVolumeRequired" side="left" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="minVolumeRequired"
                    value={merged.minVolumeRequired ?? ""}
                    onChange={change}
                    placeholder="e.g. 8000"
                    disabled={disabled}
                    className={inp}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Base Slippage (%)</span>
                  <StrategyTooltip name="slippage" side="left" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="slippage"
                    value={merged.slippage}
                    onChange={change}
                    placeholder="e.g. 5"
                    disabled={disabled}
                    className={inp}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Safety: FULL-WIDTH container that fills out */}
      <Card title="Safety" className="sm:col-span-2">
        <div className={`${fieldWrap} w-full flex items-center gap-2 px-3 py-2`}>
          <input
            type="checkbox"
            name="ignoreSafetyChecks"
            checked={!!merged.ignoreSafetyChecks}
            onChange={change}
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

  /* Execution Tab — 50/50 columns; each card stacks its fields vertically, full-width inputs */
  const ExecutionTab = () => (
    <Section>
      {/* Left: Timing & Fees */}
      <Card title="Timing & Fees">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Priority Fee (μlam)</span>
              <StrategyTooltip name="priorityFeeLamports" side="left" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="priorityFeeLamports"
                value={merged.priorityFeeLamports ?? ""}
                onChange={change}
                placeholder="e.g. 10000"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {!showRequiredOnly && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Slippage Ceiling (%)</span>
                  <StrategyTooltip name="slippageMaxPct" side="left" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="slippageMaxPct"
                    value={merged.slippageMaxPct ?? ""}
                    onChange={change}
                    placeholder="e.g. 10"
                    disabled={disabled}
                    className={inp}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Fee Escalation (μlam)</span>
                  <StrategyTooltip name="feeEscalationLamports" side="left" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="feeEscalationLamports"
                    value={merged.feeEscalationLamports ?? ""}
                    onChange={change}
                    placeholder="e.g. 5000"
                    disabled={disabled}
                    className={inp}
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
          <div className={`${fieldWrap} w-full flex items-center gap-2 px-3 py-2`}>
            <input
              type="checkbox"
              name="autoSell.enabled"
              checked={merged.autoSell?.enabled ?? true}
              onChange={change}
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
            <div className={fieldWrap}>
              <input
                type="number"
                name="autoSell.delay"
                value={merged.autoSell?.delay ?? 10000}
                onChange={change}
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Dump % of Bag</span>
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="autoSell.dumpPct"
                value={merged.autoSell?.dumpPct ?? 100}
                onChange={change}
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {!showRequiredOnly && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Random Jitter (ms)</span>
              </div>
              <div className={fieldWrap}>
                <input
                  type="number"
                  name="autoSell.randomJitterMs"
                  value={merged.autoSell?.randomJitterMs ?? 0}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );

  /* Advanced Tab — 50/50 columns; each card vertical & full width */
  const AdvancedTab = () => (
    <Section>
      <Card title="Signals & Shape">
        <div className="grid gap-4">
          <div className={`${fieldWrap} w-full flex items-center gap-2 px-3 py-2`}>
            <input
              type="checkbox"
              name="useSignals"
              checked={!!merged.useSignals}
              onChange={change}
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
            <div className={fieldWrap + " mt-1"}>
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
          </label>
        </div>
      </Card>

      <Card title="Risk Controls">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Panic-Dump % (drop)</span>
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="panicDumpPct"
                value={merged.panicDumpPct ?? ""}
                onChange={change}
                placeholder="e.g. 15"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );

  /* summary */
  const Summary = () => (
    <div className="mt-6 bg-zinc-900 rounded-md p-3">
      <p className="text-xs text-right leading-4">
        <span className="text-pink-400 font-semibold">Chad Summary</span> — 🪙{" "}
        <span className="text-emerald-300 font-semibold">
          {merged.useMultiTargets ? "Multiple Mints" : merged.outputMint || "—"}
        </span>
        ; Slip <span className="text-emerald-300 font-semibold">{merged.slippage ?? "—"}%</span>
        {merged.slippageMaxPct && (
          <>
            →<span className="text-emerald-300 font-semibold">{merged.slippageMaxPct}%</span>
          </>
        )}
        ; Fee{" "}
        <span className="text-yellow-300 font-semibold">{merged.priorityFeeLamports ?? "—"} μlam</span>
        {merged.feeEscalationLamports && (
          <>
            →+<span className="text-yellow-300 font-semibold">{merged.feeEscalationLamports}</span>
          </>
        )}
        {merged.autoSell?.enabled && (
          <>
            ; 🚀 Dump{" "}
            <span className="text-emerald-300 font-semibold">{merged.autoSell.dumpPct ?? 100}%</span> in{" "}
            <span className="text-yellow-300 font-semibold">{merged.autoSell.delay ?? 10_000} ms</span>
          </>
        )}
        {merged.panicDumpPct && <>; ☠ {merged.panicDumpPct}%</>}
        {merged.ignoreSafetyChecks && (
          <>
            ; <span className="text-red-400 font-semibold">⚠️ No Safety</span>
          </>
        )}
      </p>
    </div>
  );

  /* render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Chad Mode Config</h2>

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
          <TabButton
            active={activeTab === "execution"}
            onClick={() => setActiveTab("execution")}
            badge={tabErr.execution}
          >
            Execution
          </TabButton>
          <TabButton
            active={activeTab === "advanced"}
            onClick={() => setActiveTab("advanced")}
            badge={tabErr.advanced}
          >
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

        {activeTab === "core" && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "advanced" && <AdvancedTab />}

        <Summary />
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
              <span className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]">Ready</span>
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
              onClick={() => {
                /* keep for parity */
              }}
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

export default ChadModeConfig;
