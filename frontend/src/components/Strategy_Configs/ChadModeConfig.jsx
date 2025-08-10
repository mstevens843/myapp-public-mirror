import React, { useMemo } from "react";
import StrategyTooltip from "./StrategyTooltip";

export const REQUIRED_FIELDS = [
  "outputMint",

];

const ChadModeConfig = ({ config = {}, setConfig, disabled }) => {
  /* sensible defaults */
  const defaults = {
    slippage: 5,
    priorityFeeLamports: 10_000,
    autoSell : { dumpPct: 100, randomJitterMs: 0 },
    useMultiTargets: false,
    targetTokens: "",
    // NEW: optional signals for manual mode (disabled by default)
    useSignals: false,
    // NEW: allow selecting an execution shape (empty for default single swap)
    executionShape: "",
  };
const merged = useMemo(() => ({ ...defaults, ...config }), [config]);


  const num = e =>
    setConfig(p => ({ ...p, [e.target.name]: e.target.value === "" ? "" : +e.target.value }));
  const str = e =>
    setConfig(p => ({ ...p, [e.target.name]: e.target.value }));

  
  return (
    <>
      {/* ——— strategy description ——— */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
        🟥 This is ultra high-risk mode: it YOLOs a target token with aggressive slippage,
        priority fees, optional safety skips, and auto-dumps — designed for fast pumps and hard exits.
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* target mint or multi-list */}
<div className="col-span-2 flex flex-col gap-2">
  <div className="flex items-center gap-3">
    <div className="flex items-center gap-1">
      Target Mint (outputMint)
      <StrategyTooltip name="outputMint" />
    </div>
    <div className="flex items-center gap-1">
      <input
        type="checkbox"
        name="useMultiTargets"
        checked={merged.useMultiTargets ?? false}
        onChange={() =>
          setConfig((p) => ({ ...p, useMultiTargets: !p.useMultiTargets }))
        }
        disabled={disabled}
        className="accent-emerald-500 w-3 h-3"
      />
      <span className="text-xs text-zinc-400">Multi-Targets</span>
      <StrategyTooltip name="targetTokens" />
    </div>
  </div>

          {!merged.useMultiTargets ? (
            <input
              type="text"
              name="outputMint"
              value={merged.outputMint ?? ""}
              onChange={str}
              placeholder="Ex: 9n4nbM..."
              disabled={disabled}
              className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
            />
          ) : (
          <textarea
            name="targetTokens"
            rows={2}
            value={merged.targetTokens ?? ""}
            onChange={str}
            placeholder="Paste mint addresses – whitespace / newline separated"
            disabled={disabled}
            className="w-full text-xs pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 whitespace-nowrap overflow-x-auto"
          />
          )}
        </div>


        <label className="flex flex-col text-sm font-medium">
          <div className="flex items-center gap-1">
            Min Liquidity (USD) <StrategyTooltip name="minVolumeRequired" />
          </div>
          <input
            type="number"
            name="minVolumeRequired"
            value={merged.minVolumeRequired ?? ""}
            onChange={num}
            placeholder="e.g. 8000"
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

        {/* priority fee */}
        <label className="flex flex-col text-sm font-medium">
          <div className="flex items-center gap-1">
            Priority Fee (Lamports) <StrategyTooltip name="priorityFeeLamports" />
          </div>
          <input
            type="number"
            name="priorityFeeLamports"
            value={merged.priorityFeeLamports ?? ""}
            onChange={num}
            placeholder="e.g. 10000"
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>
      </div>

      {/* safety toggle */}
      <label className="flex items-center gap-2 text-sm col-span-2 mt-2">
        <input
          type="checkbox"
          name="ignoreSafetyChecks"
          checked={!!merged.ignoreSafetyChecks}
          onChange={() =>
            setConfig((p) => ({ ...p, ignoreSafetyChecks: !p.ignoreSafetyChecks }))
          }
          disabled={disabled}
          className="accent-red-500 w-4 h-4"
        />
        <span className="flex items-center gap-1 text-red-400">
          Skip Safety Checks (⚠️ YOLO)
          <StrategyTooltip name="skipSafetyChecks" />
        </span>
      </label>

      {/* auto-dump block */}
      <div className="col-span-2 border-t border-zinc-700 pt-3 mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="autoSell.enabled"
            checked={merged.autoSell?.enabled ?? true}
            onChange={() =>
              setConfig((p) => ({
                ...p,
                autoSell: { ...(p.autoSell ?? {}), enabled: !(p.autoSell?.enabled ?? true) },
              }))
            }
            disabled={disabled}
            className="accent-emerald-500 w-4 h-4"
          />
          Auto-Dump Enabled
          <StrategyTooltip name="autoSell.enabled" />
        </label>

        <label className="flex flex-col text-sm font-medium">
          Delay (ms) before Dump
          <input
            type="number"
            name="autoSell.delay"
            value={merged.autoSell?.delay ?? 10000}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                autoSell: { ...(p.autoSell ?? {}), delay: +e.target.value },
              }))
            }
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>
      </div>
      <label className="flex flex-col text-sm font-medium">
          Dump % of Bag
          <input
            type="number"
            name="autoSell.dumpPct"
            value={merged.autoSell?.dumpPct ?? 100}
            onChange={(e) =>
              setConfig(p => ({
                ...p,
                autoSell: { ...(p.autoSell ?? {}), dumpPct: +e.target.value },
              }))
            }
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

        <label className="flex flex-col text-sm font-medium">
          Random Jitter (ms)
          <input
            type="number"
            name="autoSell.randomJitterMs"
            value={merged.autoSell?.randomJitterMs ?? 0}
            onChange={(e) =>
              setConfig(p => ({
                ...p,
                autoSell: { ...(p.autoSell ?? {}), randomJitterMs: +e.target.value },
              }))
            }
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

        {/* ——— Signals & Execution Shape (manual) —— */}
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="useSignals"
              checked={!!merged.useSignals}
              onChange={() =>
                setConfig((p) => ({ ...p, useSignals: !p.useSignals }))
              }
              disabled={disabled}
              className="accent-emerald-500 w-4 h-4"
            />
            <span className="flex items-center gap-1">
              Enable Signals <StrategyTooltip name="useSignals" />
            </span>
          </label>

          <label className="flex flex-col text-sm font-medium">
            <span className="flex items-center gap-1">
              Execution Shape <StrategyTooltip name="executionShape" />
            </span>
            <select
              name="executionShape"
              value={merged.executionShape ?? ""}
              onChange={(e) =>
                setConfig((p) => ({ ...p, executionShape: e.target.value }))
              }
              disabled={disabled}
              className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
            >
              <option value="">Default</option>
              <option value="TWAP">TWAP</option>
              <option value="ATOMIC">Atomic Scalp</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col text-sm font-medium">
          Panic-Dump % (drop)
          <input
            type="number"
            name="panicDumpPct"
            value={merged.panicDumpPct ?? ""}
            onChange={num}
            placeholder="e.g. 15"
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

        <label className="flex flex-col text-sm font-medium">
          Slippage Ceiling %
          <input
            type="number"
            name="slippageMaxPct"
            value={merged.slippageMaxPct ?? ""}
            onChange={num}
            placeholder="e.g. 10"
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

        <label className="flex flex-col text-sm font-medium">
          Fee Escalation (L)
          <input
            type="number"
            name="feeEscalationLamports"
            value={merged.feeEscalationLamports ?? ""}
            onChange={num}
            placeholder="e.g. 5000"
            disabled={disabled}
            className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700"
          />
        </label>

      {/* summary */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊 <span className="text-pink-400 font-semibold">Chad Summary</span> — 🪙{" "}
          <span className="text-emerald-300 font-semibold">
            {merged.useMultiTargets
              ? "Multiple Mints"
              : merged.outputMint || "—"}
          </span>
          ; Slip {merged.slippage ?? "—"}%
          {merged.slippageMaxPct && <>→{merged.slippageMaxPct}%</>}
          ; Fee {merged.priorityFeeLamports ?? "—"}L
          {merged.feeEscalationLamports && <>→+{merged.feeEscalationLamports}</>}
          {merged.autoSell?.enabled && (
            <>
              ; 🚀 Dump {merged.autoSell.dumpPct ?? 100}% in{" "}
              <span className="text-yellow-300 font-semibold">
                {merged.autoSell.delay} ms
              </span>
            </>
          )}
          {merged.panicDumpPct && <>; ☠ {merged.panicDumpPct}%</>}
          {merged.ignoreSafetyChecks && (
            <>; <span className="text-red-400 font-semibold">⚠️ No Safety</span></>
          )}
        </p>
      </div>
    </>
  );
};

export default ChadModeConfig;
