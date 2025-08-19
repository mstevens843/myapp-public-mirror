import React, { useMemo, useEffect, } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* fields required by validator ---------------------------------------- */
export const REQUIRED_FIELDS = [
  "entryThreshold",
   "priceWindow",
  "volumeThreshold",
  "volumeWindow",
];

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


/* feed selector options ----------------------------------------------- */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

const ScalperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* defaults once ----------------------------------------------------- */
  const defaults = {
    entryThreshold : 1,
    priceWindow    : "5m",
    volumeThreshold: 500,
    volumeWindow   : "5m",
    volumeSpikeMultiplier: "", 
  };
  const merged = useMemo(() => ({ ...defaults, ...config }), [config]);

  const handle = ({ target }) =>
    setConfig((p) => ({
      ...p,
      [target.name]:
        ["priceWindow","volumeWindow"].includes(target.name)
          ? target.value
          : target.value === "" ? "" : parseFloat(target.value),
    }));

  /* options ----------------------------------------------------------- */
  const priceWins  = ["1m","5m"];
  const volumeWins = ["1m","5m"];

    /* ────────────────────────────────────────────────────────────
     Force‑reset invalid window settings when the user switches
     in from another strategy (e.g. Breakout’s 30 m).  
     This prevents stale values from leaking into the ConfirmModal.
  ‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑ */
  useEffect(() => {
    if (!priceWins.includes(config.priceWindow)) {
      setConfig((p) => ({ ...p, priceWindow: defaults.priceWindow }));
    }
    if (!volumeWins.includes(config.volumeWindow)) {
      setConfig((p) => ({ ...p, volumeWindow: defaults.volumeWindow }));
    }
  }, [config.priceWindow, config.volumeWindow]);

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white " +
    "placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500";

const summaryTokenList = merged.overrideMonitored
  ? "📝 My Monitored"
  : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");
    

    // Clamp summary to valid select values
const summaryPriceWindow = priceWins.includes(merged.priceWindow) ? merged.priceWindow : priceWins[0];
const summaryVolumeWindow = volumeWins.includes(merged.volumeWindow) ? merged.volumeWindow : volumeWins[0];
  /* ============================================================= */
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