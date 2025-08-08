// TokenSourceSelector.jsx
import React from "react";
import StrategyTooltip from "./StrategyTooltip";
import { ChevronDown } from "lucide-react";

const feedOptions = [
  { value: "new", label: "New listings", title: "Newly created tokens (Birdeye)" },
  { value: "trending", label: "Trending tokens", title: "Tokens with highest 24h volume" },
  { value: "top-gainers-prefiltered", label: "Top Gainers (prefiltered)", title: "Tokens with highest % gain (1h), filtered" },
  { value: "new-prefiltered", label: "New Tokens (prefiltered)", title: "Fresh mints sorted by creation time, filtered" },
  { value: "trending-prefiltered", label: "Trending (prefiltered)", title: "High volume tokens with price filter" },
];

export default function TokenSourceSelector({
  config,          // full strategy config object
  setConfig,       // setter from parent
  disabled = false // disabled flag
}) {
  const { tokenFeed = "new", overrideMonitored = false, monitoredTokens = "" } = config;

  /* —— common input style reused by parents —— */
  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  /* —— local change helpers —— */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((p) => ({
      ...p,
      [name]:
        type === "checkbox"
          ? checked
          : value,
    }));
  };

  return (
    <div className="flex flex-col gap-2 mt-5">
      <label className="flex flex-col text-sm font-medium gap-1">
        {/* ——— top row (label + checkbox) ——— */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1 whitespace-nowrap">
            Token Feed <StrategyTooltip name="tokenFeed" />
          </span>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="overrideMonitored"
              checked={overrideMonitored}
              onChange={change}
              disabled={disabled}
              className="h-3 w-3 accent-emerald-500"
            />
            <span className="text-xs text-zinc-400">Use My Token List</span>
            <StrategyTooltip name="overrideMonitored" />
          </div>
        </div>

        {/* ——— feed select ——— */}
        <div className="relative mt-1">
          <select
            name="tokenFeed"
            value={tokenFeed}
            onChange={change}
            disabled={disabled}
            className={`${inp} appearance-none pr-10`}
          >
        {feedOptions.map((o) => (
          <option key={o.value} value={o.value} title={o.title}>
            {o.label}
          </option>
        ))}
          </select>
          <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
        </div>
      </label>

      {/* ——— custom list textarea (only if checked) ——— */}
      {overrideMonitored && (
        <label className="flex flex-col text-sm font-medium gap-1 mt-2">
          <span className="flex items-center gap-1 whitespace-nowrap">
            Custom Tokens (one per line) <StrategyTooltip name="monitoredTokens" />
          </span>
          <textarea
            name="monitoredTokens"
            rows={3}
            value={monitoredTokens}
            onChange={(e) =>
              setConfig((p) => ({ ...p, monitoredTokens: e.target.value }))
            }
            placeholder="Mint addresses…"
            disabled={disabled}
            className="w-full text-sm pl-3 pr-2 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </label>
      )}
    </div>
  );
}
