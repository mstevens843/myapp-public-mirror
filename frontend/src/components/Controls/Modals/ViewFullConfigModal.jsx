/* ============================================================
 *  ViewFullConfigModal.jsx – v6.1 “Sleek-Minimal” (no pills, no glow)
 * ========================================================== */

import React, { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge }       from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { X } from "lucide-react";

/* ───────── hidden DB / runtime keys ───────── */
const HIDDEN = new Set([
  "botId","walletId","walletIds","wallet","wallets","userId","mode",
  "startTime","startedAt","pausedAt","stoppedAt","status","pid","lastTickAt",
]);

/* ───────── bucket constants (mirror editor) ───────── */
const CONFIG_FIELDS = [
  "inputMint","monitoredTokens","walletId","amountToSpend","snipeAmount",
  "slippage","interval","maxTrades","tokenFeed","haltOnFailures","autoSell",
  "maxSlippage","priorityFeeLamports","mevMode","briberyAmount",
];
const TP_FIELDS  = ["takeProfit","tpPercent","stopLoss","slPercent"];
const ADV_FIELDS = [
  "defaultMaxSlippage","skipSafety","feeEscalationLamports",
  "slippageMaxPct","priorityFee","maxDailyVolume","extras",
];
export const STRAT_EXTRAS = {
  sniper: ["entryThreshold", "volumeThreshold", "priceWindow", "volumeWindow", "minTokenAgeMinutes", "maxTokenAgeMinutes"],
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
  dipBuyer: ["dipThreshold", "recoveryWindow", "volumeWindow", "volumeThreshold"],
  breakout: ["breakoutThreshold", "volumeThreshold", "volumeWindow", "priceWindow"],
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
    "minVolumeRequired",
    "slippageMaxPct",
    "feeEscalationLamports",
    "panicDumpPct",
    "priorityFeeLamports",
    "maxOpenTrades",
    "maxTrades",
    "haltOnFailures",
    "autoSell",
    "useSignals",
  ],
  rotationBot: ["rotationInterval", "priceChangeWindow", "minMomentum", "positionSize", "cooldown", "maxRotations", "maxTradesPerCycle"],
  rebalancer: ["maxRebalances", "rebalanceThreshold", "rebalanceInterval", "targetAllocations"],
  paperTrader: ["maxSpendPerToken", "entryThreshold", "volumeThreshold", "priceWindow", "volumeWindow"],
  stealthBot: ["tokenMint", "positionSize"],
  scheduleLauncher: ["startTime", "interval", "maxTrades", "limitPrices"],
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

const SECTION_ORDER = ["Config Settings","Strategy Settings","TP/SL","Advanced Settings","Other"];

/* ======================================================= */
export default function ViewFullConfigModal({ open, onClose, config }) {
  if (!config) return null;
  const { strategy, name, config: cfg, createdAt } = config;

  /* ───────── group fields ───────── */
  const sectionOf = (k) => {
    if (CONFIG_FIELDS.includes(k)) return "Config Settings";
    if (TP_FIELDS.includes(k))     return "TP/SL";
    if (ADV_FIELDS.includes(k))    return "Advanced Settings";
    if (STRAT_EXTRAS[strategy]?.includes(k)) return "Strategy Settings";
    return "Other";
  };

  const grouped = Object.entries(cfg)
    .filter(([k]) => !HIDDEN.has(k))
    .reduce((a,[k,v])=>{
      const sec = sectionOf(k);
      (a[sec] ||= []).push([k,v]);
      return a;
    },{});

  /* ───────── render ───────── */
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl p-0">
        {/* header */}
        <button
  onClick={onClose}
  className="absolute right-3 top-3 z-20 text-zinc-400 hover:text-white transition p-1"
  title="Close"
>
  <X size={18} />
</button>
<DialogHeader className="sticky top-0 bg-zinc-900 px-6 pt-5 pb-3 border-b border-zinc-800 rounded-t-2xl z-10">
          <DialogTitle className="text-base font-semibold text-white">
            {name || `${capitalize(strategy)} Config`}
          </DialogTitle>
          {createdAt && (
            <p className="mt-0.5 text-[11px] text-zinc-400">
              saved {formatDistanceToNow(new Date(createdAt))} ago
            </p>
          )}
        </DialogHeader>

        {/* body */}
        <ScrollArea className="max-h-[70vh] overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {SECTION_ORDER.map((sec) => {
              const items = grouped[sec] || [];
              if (!items.length) return null;
              return (
                <section key={sec}>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-400/90">
                    {sec}
                  </h3>

                  {/* 4-column grid → label|value|label|value */}
                  <dl className="grid grid-cols-4 gap-x-2 gap-y-1">
                    {items.map(([k,v])=>(
                      <Field key={k} label={k} value={v} />
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/* ── field pair ── */
function Field({ label, value }) {
  const isSafetyRow = label === "safetyChecks";

  return (
    <>
      <dt className="truncate text-sm font-medium text-zinc-400">{label}</dt>
      <dd
        className={`
          text-sm text-zinc-100
          ${isSafetyRow ? "col-span-3 flex flex-wrap items-center gap-1" : ""}
        `}
      >
        {renderValue(value, label)}
      </dd>
    </>
  );
}

/* ── helpers ── */
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function copy(text, target) {
  navigator.clipboard.writeText(text).then(() => {
    if (!target) return;
    target.classList.add("opacity-0");
    setTimeout(()=>target.classList.remove("opacity-0"),1000);
  });
}


function renderValue(value) {
  // ✅ BOOLEAN → pill chip
  if (typeof value === "boolean") {
    return (
      <span
        className={`
          inline-block rounded-md px-1.5 py-0.5 font-semibold
          ${value ? "bg-emerald-600/30 text-emerald-200" : "bg-rose-700/30 text-rose-200"}
        `}
      >
        {value ? "true" : "false"}
      </span>
    );
  }

// ✅ OBJECT → pills inline, wrap beside label
if (typeof value === "object" && value !== null) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {Object.entries(value).map(([k, v]) => (
        <Badge
          key={k}
          className={`
            text-[10px] font-semibold px-1.5 py-0.5
            ${v ? "bg-emerald-700/30 text-emerald-200" : "bg-rose-700/30 text-rose-200"}
          `}
        >
          {k}:{v ? "✓" : "×"}
        </Badge>
      ))}
    </div>
  );
}



  const str = String(value);
  if (str.length > 16) {
    const start = str.slice(0,6);
    const end   = str.slice(-5);
    return (
      <span className="inline-flex items-center gap-1">
        <span>{`${start}…${end}`}</span>
        <button
          onClick={(e)=>copy(str, e.currentTarget.firstChild)}
          className="group relative"
          title="Copy"
        >
          <Copy size={12} className="text-zinc-400 group-hover:text-emerald-300" />
          <Check
            size={12}
            className="absolute inset-0 m-auto text-emerald-400 opacity-0 transition-opacity duration-200"
          />
        </button>
      </span>
    );
  }
  return str;
}
