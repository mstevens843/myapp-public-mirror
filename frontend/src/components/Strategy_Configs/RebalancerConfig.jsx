// RebalancerConfig.jsx — Sniper-style tabbed layout (Core / Execution)
// Solid (non-transparent) backgrounds, darker container, pretty toggle, no “Apply” button

import React, { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import TargetWeightsBuilder from "./TargetWeightsBuilder";
import StrategyTooltip from "./StrategyTooltip";
import { fetchPortfolio, fetchActiveWallet } from "@/utils/auth";
import { useUser } from "@/contexts/UserProvider";

/* Required keys used by parent validators */
export const REQUIRED_FIELDS = [
  "rebalanceThreshold",
  "rebalanceInterval",
  "targetAllocations",
  "maxRebalances",
];

/* Optional keys (still show up in summary when present) */
export const OPTIONAL_FIELDS = ["slippage", "priorityFeeLamports", "autoWallet"];

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

const Section = ({ children }) => (
  <div className="grid gap-4 md:gap-5 sm:grid-cols-2">{children}</div>
);

const TabButton = ({ active, onClick, children, badge }) => (
  <button
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

/* Tabs -> keys for error badges (Advanced removed) */
const TAB_KEYS = {
  core: ["rebalanceThreshold", "targetAllocations", "autoWallet"],
  execution: ["rebalanceInterval", "maxRebalances", "slippage", "priorityFeeLamports"],
};

/* ───────────────────────────── Validation ───────────────────────────── */
const validateRebalancer = (cfg = {}) => {
  const errs = [];
  const numAllocs = Object.keys(cfg.targetAllocations ?? {}).length;

  if (
    cfg.rebalanceThreshold === "" ||
    cfg.rebalanceThreshold === undefined ||
    Number.isNaN(+cfg.rebalanceThreshold) ||
    +cfg.rebalanceThreshold <= 0
  )
    errs.push("rebalanceThreshold must be > 0.");

  if (
    cfg.rebalanceInterval === "" ||
    cfg.rebalanceInterval === undefined ||
    Number.isNaN(+cfg.rebalanceInterval) ||
    +cfg.rebalanceInterval <= 0
  )
    errs.push("rebalanceInterval must be > 0 ms.");

  if (!cfg.autoWallet && numAllocs < 2) {
    errs.push("targetAllocations requires at least two tokens (or enable Auto Balance).");
  }

  if (
    cfg.maxRebalances === "" ||
    cfg.maxRebalances === undefined ||
    Number.isNaN(+cfg.maxRebalances) ||
    +cfg.maxRebalances <= 0
  )
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
  if (categorized < errors.length) counts.core += errors.length - categorized; // dump uncategorized to core
  return counts;
};

/* ───────────────────────────── Component ───────────────────────────── */
const RebalancerConfig = ({ config, setConfig, disabled, onValidityChange }) => {
  const { activeWallet } = useUser();
  const [walletTokens, setWalletTokens] = useState([]);
  const [loading, setLoading] = useState(false);

  /* Sensible defaults (non-destructive merge) */
  const defaults = {
    walletId: undefined,
    tokens: [],
    slippage: 8, // %
    rebalanceThreshold: 5, // %
    rebalanceInterval: 600_000, // ms (10 min)
    maxRebalances: 10,
    autoWallet: false,
    targetAllocations: {},
    priorityFeeLamports: "", // μlam
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* Derived counts */
  const numAllocations = Object.keys(merged.targetAllocations || {}).length;
  const tooFewTargets = !merged.autoWallet && numAllocations < 2;

  /* Wallet tokens loader */
  useEffect(() => {
    let cancelled = false;

    async function loadTokens() {
      try {
        let walletId = merged?.walletId || activeWallet?.id;
        if (!walletId) {
          walletId = await fetchActiveWallet();
          if (walletId) setConfig((prev) => ({ ...prev, walletId }));
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
    return () => {
      cancelled = true;
    };
  }, [merged?.walletId, activeWallet?.id, setConfig]);

  /* Propagate validity upwards */
  useEffect(() => {
    if (typeof onValidityChange === "function") {
      onValidityChange(!tooFewTargets);
    }
  }, [tooFewTargets, onValidityChange]);

  /* Handlers */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : name === "rebalanceInterval"
          ? value === ""
            ? ""
            : parseInt(value, 10)
          : value === ""
          ? ""
          : isNaN(Number(value))
          ? value
          : parseFloat(value),
    }));
  };

  /* Equal-weight recalculation when Auto Balance toggles on */
  function toggleAutoEqual() {
    setConfig((prev) => {
      const nextAuto = !prev.autoWallet;
      if (!nextAuto) return { ...prev, autoWallet: nextAuto };
      const mints = Object.keys(prev.targetAllocations ?? {});
      if (mints.length === 0) return { ...prev, autoWallet: nextAuto };
      const equal = +(100 / mints.length).toFixed(2);
      return {
        ...prev,
        autoWallet: nextAuto,
        targetAllocations: Object.fromEntries(mints.map((m) => [m, equal])),
      };
    });
  }

  /* UI classes */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 " +
    "hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";

  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  /* Validation + badges */
  const errors = validateRebalancer(merged);
  const tabErr = countErrorsForTab(errors);

  /* Tabs state */
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* Tabs */
  const CoreTab = () => (
    <Section>
      <Card title="Core Settings" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Rebalance threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rebalance Threshold (%)</span>
              <StrategyTooltip name="rebalanceThreshold" side="left" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="rebalanceThreshold"
                value={merged.rebalanceThreshold}
                onChange={change}
                placeholder="e.g. 5"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Auto Balance toggle (clean text; helper removed) */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <span>Auto Balance Mode (equal %)</span>
              <StrategyTooltip name="targetWeights" side="left" />
            </div>
            <div className={fieldWrap + " flex items-center px-3 py-2"}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="autoWallet"
                  checked={!!merged.autoWallet}
                  onChange={toggleAutoEqual}
                  disabled={disabled}
                  className="accent-emerald-500 w-4 h-4"
                />
                <span className="text-zinc-300">Equalize current targets</span>
              </label>
            </div>
          </div>
        </div>

        {/* Target allocations builder */}
        <div className="mt-4">
          <div className="text-sm font-medium text-zinc-300 mb-1 flex items-center gap-2">
            <span>Target Allocations</span>
            <StrategyTooltip name="targetAllocations" side="left" />
            {loading && <span className="text-xs text-zinc-400">Loading wallet tokens…</span>}
          </div>

          <div className="rounded-md border border-zinc-700 bg-zinc-900 p-2">
            <TargetWeightsBuilder
              targetWeights={merged.targetAllocations || {}}
              onUpdate={(updated) =>
                setConfig((prev) => ({
                  ...prev,
                  targetAllocations: updated,
                }))
              }
              disabled={disabled}
              autoEqual={merged.autoWallet}
              walletTokens={walletTokens}
            />
          </div>

          {tooFewTargets && (
            <p className="text-xs text-red-400 mt-2">
              ➡️ Add at least <strong>two</strong> token mints to start this strategy or enable
              Auto Balance.
            </p>
          )}
        </div>
      </Card>
    </Section>
  );

  /* Execution Tab — 50/50 layout; left stacks 3 vertical, right stacks 1 */
  const ExecutionTab = () => (
    <div className="grid gap-4 md:gap-5 sm:grid-cols-2">
      {/* Left: three fields stacked vertically */}
      <Card title="Timing & Limits" className="sm:col-span-1">
        <div className="space-y-4">
          {/* Interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rebalance Interval (ms)</span>
              <StrategyTooltip name="rebalanceInterval" side="left" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="rebalanceInterval"
                value={merged.rebalanceInterval}
                onChange={change}
                placeholder="e.g. 600000"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Max rebalances */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Max Rebalances (#)</span>
              <StrategyTooltip name="maxRebalances" side="left" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="maxRebalances"
                value={merged.maxRebalances}
                onChange={change}
                placeholder="e.g. 10"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Slippage */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Slippage (%)</span>
              <StrategyTooltip name="slippage" side="left" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                step="any"
                name="slippage"
                value={merged.slippage}
                onChange={change}
                placeholder="e.g. 8"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Right: single field stacked */}
      <Card title="Fees" className="sm:col-span-1">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
            <span>Priority Fee (μlam)</span>
            <StrategyTooltip name="priorityFeeLamports" side="left" />
          </div>
          <div className={fieldWrap}>
            <input
              type="number"
              name="priorityFeeLamports"
              value={merged.priorityFeeLamports}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 1000"
              className={inp}
            />
          </div>
        </div>
      </Card>
    </div>
  );

  /* Summary helpers */
  const minutes = (ms) => (ms && !Number.isNaN(+ms) ? Math.round(+ms / 60000) : "—");

  /* Render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Rebalancer Config</h2>

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
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {activeTab === "core" && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs leading-4">
            <span className="text-pink-400 font-semibold">Rebalance Summary</span> —&nbsp; Threshold{" "}
            <span className="text-emerald-300 font-semibold">≥ {merged.rebalanceThreshold}%</span>; &nbsp;Interval{" "}
            <span className="text-emerald-300 font-semibold">{minutes(merged.rebalanceInterval)} min</span>; &nbsp;Max{" "}
            <span className="text-emerald-300 font-semibold">{merged.maxRebalances}</span> cycles; &nbsp;Slippage{" "}
            <span className="text-emerald-300 font-semibold">{merged.slippage}%</span>; &nbsp;Targets{" "}
            <span className="text-indigo-300 font-semibold">
              {merged.autoWallet ? "Auto" : `${numAllocations} assets`}
            </span>
            {merged.priorityFeeLamports ? (
              <>
                ; CU fee <span className="text-yellow-300 font-semibold">{merged.priorityFeeLamports} μlam</span>
              </>
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

export default RebalancerConfig;
