import React, { useMemo, useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import TargetWeightsBuilder from "./TargetWeightsBuilder";
import StrategyTooltip from "./StrategyTooltip";
import { fetchPortfolio, fetchActiveWallet } from "@/utils/auth"
import AdvancedFields from "../ui/AdvancedFields";
import { useUser } from "@/contexts/UserProvider";

export const REQUIRED_FIELDS = [
  "rebalanceThreshold",
  "rebalanceInterval",
  "targetAllocations",
  "maxRebalances"
];




const RebalancerConfig = ({ config, setConfig, disabled, customFields }) => {
  const [walletTokens, setWalletTokens] = useState([]);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const tokenMenuRef = useRef(null);
const { activeWallet, activeWalletId } = useUser();

console.log("walletId from config:", config.walletId);
console.log("activeWalletId ctx   :", activeWalletId);

useEffect(() => {
  async function loadTokens() {
    // ‑‑ figure out the wallet to use
    let walletId = config?.walletId || activeWallet?.id;
    if (!walletId) {
      walletId = await fetchActiveWallet();      // <‑‑ new
      if (walletId) setConfig(prev => ({ ...prev, walletId })); // cache it
    }
    if (!walletId) return;                       // still nothing? bail.

    setLoading(true);
    try {
      const tokens = await fetchPortfolio(walletId);
      setWalletTokens(tokens);
      console.log("🪙 Rebalancer loaded tokens:", tokens);
    } catch (err) {
      console.error("❌ Rebalancer failed:", err);
      toast.error("Failed to load wallet tokens");
    } finally {
      setLoading(false);
    }
  }

  loadTokens();
}, [config?.walletId, activeWallet?.id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: value === "" ? "" : parseFloat(value),
    }));
  };

    /* ── defaults merge ────────────────────────────────────────── */
  const defaults = {
    tokens           : [],
    slippage         : 0.5,

  };

    const merged = useMemo(
      () => ({ ...defaults, ...(config ?? {}) }),
      [config],
    );
  

  /* derive summary counts */
  const numAllocations = config?.targetAllocations
    ? Object.keys(config.targetAllocations).length
    : 0;

  /* 🚦  NEW: need ≥ 2 tokens */
  const tooFewTargets = !config.autoWallet && numAllocations < 2;


/* ─── helper: equal-weight recalculation when autoWallet flips ─── */
function rebalanceEqualWeights(prev) {
  const mints = Object.keys(prev.targetAllocations ?? {});
  if (!prev.autoWallet || mints.length === 0) return prev;
  const equal = +(100 / mints.length).toFixed(2);
  return {
    ...prev,
    targetAllocations: Object.fromEntries(mints.map(m => [m, equal])),
  };
}

  if (loading) return <div className="text-white">Loading wallet tokens…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
        ⚖️ This strategy monitors your portfolio and automatically rebalances it back to target weights
        when allocations drift — perfect for maintaining structured exposure.
      </div>

      {/* Threshold */}
      <label className="flex flex-col text-sm font-medium gap-1">
        <div className="flex items-center gap-1">
          Rebalance Threshold (%) <StrategyTooltip name="rebalanceThreshold" />
        </div>
        <input
          type="number"
          name="rebalanceThreshold"
          value={config.rebalanceThreshold ?? ""}
          onChange={handleChange}
          placeholder="e.g. 5"
          disabled={disabled}
          className="pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400
                     focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition-all"
        />
      </label>




      {/* Target Allocations */}
<div className="flex flex-col text-sm font-medium gap-2 pt-2">
  <div className="flex items-center gap-2">
    Target Allocations
    <input
      type="checkbox"
      name="autoWallet"
      checked={config.autoWallet ?? false}
      onChange={() =>
        setConfig(prev => rebalanceEqualWeights({
          ...prev,
          autoWallet: !prev.autoWallet,
        }))
      }
      disabled={disabled}
      className="accent-emerald-500 w-3 h-3"
    />
    <span className="select-none">Auto Balance Mode (equal %)</span>
    <StrategyTooltip name="targetWeights" />
  </div>

<TargetWeightsBuilder
  targetWeights={config.targetAllocations || config.targetWeights || {}}
  onUpdate={(updated) =>
    setConfig((prev) => ({
      ...prev,
      targetAllocations: updated,
    }))
  }
  disabled={disabled}
  autoEqual={config.autoWallet}
  walletTokens={walletTokens}
/>

        {tooFewTargets && (
          <p className="text-xs text-red-400 mt-1">
            ➡️ Add at least <strong>two</strong> token mints to start this strategy.
          </p>
        )}
      </div>

      <AdvancedFields
        config={merged}
        setConfig={setConfig}
        disabled={disabled}
        fields={customFields ?? [
          { label: "Min Market-Cap (USD)", name: "minMarketCap", placeholder: "e.g. 100000" },
          { label: "Max Market-Cap (USD)", name: "maxMarketCap", placeholder: "e.g. 2000000" },
          { label: "Halt on Fails (#)", name: "haltOnFailures", placeholder: "e.g. 5" },
          { label: "Per-token Cooldown (s)", name: "cooldown", placeholder: "e.g. 30" },
          { label: "Max Slippage (%)", name: "maxSlippage", placeholder: "e.g. 0.5" },
          { label: "Priority Fee (lamports)", name: "priorityFeeLamports", placeholder: "e.g. 20000" },
        ]}
      />

      {/* Strategy summary */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊 <span className="text-pink-400 font-semibold">Rebalance Summary</span> — 
          Threshold: <span className="text-emerald-300 font-semibold">
            ≥ {config.rebalanceThreshold ?? "—"}%
          </span>; Slippage: <span className="text-emerald-300 font-semibold">
            {config.slippage ?? "—"}%
          </span>; Interval: <span className="text-emerald-300 font-semibold">
            {Math.round((config.rebalanceInterval ?? 600000)/60000)} min
          </span>; 
          Targets: <span className="text-indigo-300 font-semibold">
            {numAllocations} Assets
          </span>
          Targets: <span className="text-indigo-300 font-semibold">
            {config.autoWallet ? "Auto" : `${numAllocations} Assets`}
          </span>
        </p>
      </div>
     {/* bubble this flag up so the parent (StrategyCard) can disable Save */}
      {typeof onValidityChange === "function" && onValidityChange(!tooFewTargets)}
      <a
  href="https://birdeye.so/"
  target="_blank"
  rel="noopener noreferrer"
  className="text-xs text-emerald-400 hover:underline absolute bottom-8 left-4"
>
  🔍 Open Birdeye
</a>
    </div>
    
  );
};

export default RebalancerConfig;