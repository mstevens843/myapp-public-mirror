import React from "react";
export default function LimitEntryBlock({ state, setState, disabled }) {
  return (
    <div className="space-y-3">
      {/* Limit Price  */}
      <label className="block text-xs text-zinc-400">
        Limit Price (USD)
        <input
          type="number"
          step="0.0001"
          min="0"
          placeholder="0.25"
          value={state.targetPriceUSD ?? ""}
          onChange={(e) =>
            setState((p) => ({ ...p, targetPriceUSD: e.target.value || undefined }))
          }
          disabled={disabled}
          className="mt-1 w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </label>

      {/* Spend USDC toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={state.buyWithUSDC || false}
          onChange={(e) =>
            setState((p) => ({ ...p, buyWithUSDC: e.target.checked || undefined }))
          }
          disabled={disabled}
        />
        Spend USDC instead of SOL
      </label>

      {/* USDC amount (only if toggle on) */}
      {state.buyWithUSDC && (
        <label className="block text-xs text-zinc-400">
          Amount to Spend (USDC)
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="250"
            value={state.usdcAmount ?? ""}
            onChange={(e) =>
              setState((p) => ({ ...p, usdcAmount: e.target.value || undefined }))
            }
            disabled={disabled}
            className="mt-1 w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
          />
        </label>
      )}
    </div>
  );
}
