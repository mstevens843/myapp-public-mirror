/* ============================================================
 *  SavedConfigCard.jsx – v3.0 “Pro-Card” 🟢✨
 *  -----------------------------------------------------------
 *  • Senior-level visual polish (glass, hover-lift, subtle shadows)
 *  • Same field buckets as SavedConfigModal (keeps UX consistent)
 *  • Key metrics preview row
 *  • Optional inline expand/collapse for grouped details
 * ========================================================== */

import React, { useState } from "react";
import {
  Trash, Eye, RotateCcw, Pencil, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import autoNameConfig from "../../../utils/autoNameConfig";
import { Badge } from "@/components/ui/badge";

/* -------- bucket constants (mirror modal) -------- */
const CONFIG_FIELDS = [
  "inputMint","amountToSpend","snipeAmount","slippage","interval","maxTrades",
  "tokenFeed","haltOnFailures","autoSell","maxSlippage","priorityFeeLamports",
];
const TP_FIELDS  = ["takeProfit","tpPercent","stopLoss","slPercent"];
const ADV_FIELDS = ["mevMode","briberyAmount","slippageMaxPct","extras"];

export const STRAT_EXTRAS = {
  sniper: ["entryThreshold", "volumeThreshold", "priceWindow", "volumeWindow", "tokenFeed", "minTokenAgeMinutes", "maxTokenAgeMinutes"],
  scalper: [
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
    "maxDailyVolume",
    "maxOpenTrades",
    "maxTrades",
    "haltOnFailures",
    "minMarketCap",
    "maxMarketCap",
    "cooldown",
    "takeProfitPct",
    "stopLossPct",
    "volumeSpikeMultiplier",
    "useSignals",
    "maxHoldSeconds",
    "disableSafety",
    "safetyChecks",
  ],
  dipBuyer: ["dipThreshold", "recoveryWindow", "volumeThreshold", "volumeWindow"],
  breakout: ["breakoutThreshold", "volumeThreshold", "priceWindow", "volumeWindow"],
  trendFollower: [
    "entryThreshold",
    "volumeThreshold",
    "trendWindow",
    "priceWindow",
    "volumeWindow",
    "emaPeriods",
    "trailingPct",
    "sarEnabled",
    "pyramidEnabled",
    "riskPerAdd",
    "maxRisk",
    "delayBeforeBuyMs",
    "maxOpenTrades",
    "maxDailyVolume",
    "minMarketCap",
    "maxMarketCap",
    "useSignals",
    "maxHoldSeconds",
  ],
  delayedSniper: [
    "delayBeforeBuyMs",
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
    "minTokenAgeMinutes",
    "maxTokenAgeMinutes",
    "breakoutPct",
    "pullbackPct",
    "ignoreBlocks",
    "maxOpenTrades",
    "maxDailyVolume",
    "minMarketCap",
    "maxMarketCap",
  ],
  chadMode: [
    "useMultiTargets",
    "outputMint",
    "targetTokens",
    "minVolumeRequired",
    "priorityFeeLamports",
    "slippageMaxPct",
    "feeEscalationLamports",
    "panicDumpPct",
    "maxOpenTrades",
    "maxTrades",
    "haltOnFailures",
    "autoSell",
    "useSignals",
  ],
  rotationBot: ["wallets", "tokens", "sectors", "rotationInterval", "priceChangeWindow", "minMomentum", "positionSize", "cooldown", "maxRotations", "maxTrades", "slippage", "maxSlippage", "priorityFeeLamports", "haltOnFailures"],
  rebalancer: ["walletLabels", "maxRebalances", "slippage", "targetAllocations", "rebalanceThreshold", "rebalanceInterval", "maxSlippage", "priorityFeeLamports", "autoWallet", "haltOnFailures"],
  paperTrader: ["outputMint", "maxSpendPerToken", "entryThreshold", "volumeThreshold", "priceWindow", "volumeWindow", "tokenFeed", "minTokenAgeMinutes", "maxTokenAgeMinutes"],
  stealthBot: ["wallets", "tokenMint", "positionSize", "slippage", "maxSlippage", "priorityFeeLamports"],
  scheduleLauncher: ["outputMint", "startTime", "interval", "maxTrades", "haltOnFailures", "limitPrices", "mevMode", "briberyAmount", "priorityFeeLamports", "takeProfit", "tpPercent", "stopLoss", "slPercent"],
  turboSniper: [
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
    "minTokenAgeMinutes",
    "maxTokenAgeMinutes",
    "minMarketCap",
    "maxMarketCap",
    "ghostMode",
    "coverWalletId",
    "multiBuy",
    "multiBuyCount",
    "prewarmAccounts",
    "multiRoute",
    "autoRug",
    "useJitoBundle",
    "jitoTipLamports",
    "jitoRelayUrl",
    "autoPriorityFee",
    "rpcEndpoints",
    "rpcMaxErrors",
    "killSwitch",
    "killThreshold",
    "poolDetection",
    "allowedDexes",
    "excludedDexes",
    "splitTrade",
    "tpLadder",
    "trailingStopPct",
    "turboMode",
    "autoRiskManage",
    "privateRpcUrl",
    "maxOpenTrades",
    "delayBeforeBuyMs",
    "priorityFeeLamports",
  ],
};


const SECTION_ORDER = [
  "Config Settings",
  "Strategy Settings",
  "TP/SL",
  "Advanced Settings",
];

/* ------------------------------------------------------------ */
export default function SavedConfigCard({
  config,
  onLoad,
  onDelete,
  onViewDetails,
  onEdit = () => {},
}) {
  const [open, setOpen] = useState(false);
  // local state to toggle note visibility. If the config contains a
  // user‑provided note (stored on cfg.note) we allow the card to show it
  // inline when requested.
  const [noteOpen, setNoteOpen] = useState(false);
  const { strategy, name, config: cfg } = config;

  /* ---- preview bar (quick glance) ---- */
// Only show preview metrics if they're in STRAT_EXTRAS
const preview = {};
(STRAT_EXTRAS[strategy] || []).forEach((k) => {
  if (cfg[k] !== undefined) {
    preview[k] = cfg[k];
  }
});

  /* ---- grouping (identical logic to modal) ---- */
  const sectionOf = (k) => {
    if (CONFIG_FIELDS.includes(k)) return "Config Settings";
    if (TP_FIELDS.includes(k))     return "TP/SL";
    if (ADV_FIELDS.includes(k))    return "Advanced Settings";
    if (STRAT_EXTRAS[strategy]?.includes(k)) return "Strategy Settings";
    return null; // omit from card view if not whitelisted
  };

  const grouped = Object.entries(cfg).reduce((acc, [k, v]) => {
    const sec = sectionOf(k);
    if (!sec) return acc;
    (acc[sec] ||= []).push([k, v]);
    return acc;
  }, {});

  /* ---- render helpers ---- */
  const Metric = ({ label, value }) => (
    <div className="flex gap-1">
      <span className="text-zinc-400">{label}:</span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );

  return (
    <div
      className="rounded-xl border border-zinc-700/60 bg-zinc-800/50 p-4 shadow-sm transition
                 hover:-translate-y-0.5 hover:shadow-lg hover:border-emerald-600/60"
    >
      {/* top row */}
      <div className="flex items-start justify-between">
        {/* title + meta */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-emerald-300">
            {name || autoNameConfig(strategy, cfg)}
          </span>

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Badge variant={getStrategyColor(strategy)}>{strategy}</Badge>
            {config.createdAt && (
              <span>
                saved {formatDistanceToNow(new Date(config.createdAt))} ago
              </span>
            )}
            {/* Note indicator – show a small toggle if a note exists */}
            {cfg.note && (
              <button
                onClick={() => setNoteOpen((prev) => !prev)}
                className="ml-1 underline text-blue-400 hover:text-blue-300 focus:outline-none"
                title={noteOpen ? 'Hide note' : 'View note'}
              >
                {noteOpen ? 'Hide Note' : 'View Note'}
              </button>
            )}
          </div>
        </div>

        {/* actions */}
{/* actions */}
<div className="flex flex-wrap gap-2 text-zinc-300 mt-2 sm:mt-0 sm:ml-auto">
  {/* <button
    onClick={onViewDetails}
    title="View Details"
    className="flex items-center gap-2 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700/40 transition"
  >
    <Eye size={14} />
    Details
  </button> */}

  <button
    onClick={onEdit}
    title="Edit Config"
    className="flex items-center gap-2 rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-900/20 transition"
  >
    <Pencil size={14} />
    Edit
  </button>

  <button
    onClick={onLoad}
    title="Load Config"
    className="flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/20 transition"
  >
    <RotateCcw size={14} />
    Load Config
  </button>

  <button
    onClick={onDelete}
    title="Delete Config"
    className="flex items-center gap-2 rounded-lg border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/20 transition"
  >
    <Trash size={14} />
    Delete
  </button>

  <button
    onClick={() => setOpen(!open)}
    title={open ? "Collapse" : "Expand"}
    className="flex items-center gap-2 rounded-lg border border-yellow-600 px-3 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-900/20 transition"
  >
    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    {open ? "Collapse" : "Expand"}
  </button>
</div>

      </div>

      {/* quick metrics */}
{/* strategy preview metrics */}
{Object.keys(preview).length > 0 && (
  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
    {Object.entries(preview).map(([label, value]) => (
      <Metric key={label} label={label} value={value} />
    ))}
  </div>
)}

      {/* grouped details (collapse) */}
      {open && (
        <div className="mt-4 space-y-4 text-xs">
          {SECTION_ORDER.map((sec) => {
            const items = grouped[sec] || [];
            if (!items.length) return null;
            return (
              <div key={sec}>
                <p className="mb-1 font-bold text-emerald-400">{sec}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {items.map(([k, v]) => (
                    <div key={k} className="flex gap-1 truncate">
                      <span className="text-zinc-400">{k}:</span>
                      <span className="font-mono text-zinc-100 truncate">
                        {String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* note content – show below the card when toggled */}
      {noteOpen && cfg.note && (
        <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-300 whitespace-pre-wrap">
          {cfg.note}
        </div>
      )}
    </div>
  );
}

/* ------------- utilities ------------- */
const IconBtn = ({ onClick, title, children, className="" }) => (
  <button
    onClick={onClick}
    title={title}
    className={`rounded-md p-1 hover:bg-zinc-700/40 transition ${className}`}
  >
    {children}
  </button>
);

function resolveAmount(cfg = {}) {
  return (
    cfg.amountToSpend ??
    cfg.snipeAmount ??
    cfg.spendAmount ??
    cfg.amount ??
    "?"
  );
}

function getStrategyColor(mode = "") {
  return {
    sniper: "glow",
    scalper: "green",
    breakout: "red",
    chadmode: "glow",
    dipbuyer: "green",
    delayedsniper: "default",
    trendfollower: "red",
    papertrader: "secondary",
    rebalancer: "green",
    rotationbot: "default",
    stealthbot: "default",
    schedulelauncher: "secondary",
  }[mode.toLowerCase()] || "default";
}
