/* ============================================================
 *  SavedConfigModal.jsx – v4.3 “Builder-Groups” 🟢✨
 *  -----------------------------------------------------------
 *  • Groups fields by how the config-builder actually structures them
 *    – Config Settings → base fields from buildBaseConfig
 *    – Strategy Settings → extras from individual strategy builders
 *    – TP/SL → take-profit / stop-loss
 *    – Advanced Settings → global power-user knobs
 *    – Any leftovers fall into “Other”
 * ========================================================== */

import React, { useEffect, useState } from "react";
import { Dialog }                     from "@headlessui/react";
import { motion }                     from "framer-motion";
import { toast }                      from "sonner";

/* children */
import SavedConfigCard     from "./SavedConfigCard";
import ViewFullConfigModal from "./ViewFullConfigModal";

/* API helpers */
import {
  listSavedConfigs,
  saveConfig,
  deleteSavedConfig,
  editSavedConfig,
} from "@/utils/autobotApi";
import StrategyTooltip from "../../Strategy_Configs/StrategyTooltip";
/* icons */
import { Save, BarChart3, Edit2, Info } from "lucide-react";

/* ────────────────────────────────────────────────────────── */
/* ---- SECTION BUCKETS (mirrors buildBaseConfig logic) ---- */
const CONFIG_FIELDS = [
  "inputMint","monitoredTokens","walletId","amountToSpend","snipeAmount",
  "slippage","interval","maxTrades","tokenFeed","haltOnFailures","autoSell",
  "maxSlippage","priorityFeeLamports","mevMode","briberyAmount",
];

const TP_FIELDS      = ["takeProfit","tpPercent","stopLoss","slPercent"];
const ADV_FIELDS     = [
  "defaultMaxSlippage","skipSafety","feeEscalationLamports",
  "slippageMaxPct","priorityFee","maxDailyVolume","extras",
];

/* Strategy-specific extras (pulled straight from the JS builders) */
export const STRAT_EXTRAS = {
  sniper: [
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
    "minTokenAgeMinutes",
    "maxTokenAgeMinutes",
  ],
  scalper: [
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
    // new scalper fields
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
  dipBuyer: [
    "dipThreshold",
    "recoveryWindow",
    "volumeWindow",
    "volumeThreshold",
  ],
  breakout: [
    "breakoutThreshold",
    "volumeThreshold",
    "volumeWindow",
    "priceWindow",
  ],
  trendFollower: [
    "entryThreshold",
    "volumeThreshold",
    "trendWindow",
    "priceWindow",
    "volumeWindow",
    // new trend follower fields
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
    // new delayed sniper fields
    "breakoutPct",
    "pullbackPct",
    "ignoreBlocks",
    "maxOpenTrades",
    "maxDailyVolume",
    "minMarketCap",
    "maxMarketCap",
  ],
  chadMode: [
    // existing fields
    "minVolumeRequired",
    "slippageMaxPct",
    "feeEscalationLamports",
    "panicDumpPct",
    "priorityFeeLamports",
    // new chad mode fields
    "maxOpenTrades",
    "maxTrades",
    "haltOnFailures",
    "autoSell",
    "useSignals",
  ],
  rotationBot: [
    "rotationInterval",
    "priceChangeWindow",
    "minMomentum",
    "positionSize",
    "cooldown",
    "maxRotations",
    "maxTrades",
    "slippage",
    "maxSlippage",
    "priorityFeeLamports",
    "haltOnFailures",
  ],
  rebalancer: [
    "maxRebalances",
    "rebalanceThreshold",
    "rebalanceInterval",
    "targetAllocations",
  ],
  paperTrader: [
    "maxSpendPerToken",
    "entryThreshold",
    "volumeThreshold",
    "priceWindow",
    "volumeWindow",
  ],
  stealthBot: ["tokenMint", "positionSize"],
  scheduleLauncher: ["startTime", "interval", "maxTrades", "limitPrices"],
  // brand new turbo sniper extras.  Include all toggles to ensure users can
  // view and edit saved turbo configurations.
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
    "Strategy Settings",
  "Config Settings",
  "TP/SL",
  "Advanced Settings",
  "Other",
];

/* ────────────────────────────────────────────────────────── */
export default function SavedConfigModal({
  open,
  onClose,
  mode,
  currentConfig,
  onLoad,
}) {
  const [configs, setConfigs]   = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [query,    setQuery]    = useState("");
  const [sortBy,   setSortBy]   = useState("name");
  const [viewing,  setViewing]  = useState(null);
  const [configName,setConfigName]=useState("");
  const [configNote,setConfigNote]=useState("");
  const [editing,  setEditing]  = useState(null);  // { id, name, strategy, config }
  const [localInput, setLocalInput] = useState({});

  /* ───────── FETCH LIST ───────── */
  useEffect(() => {
    if (!open) return;
    (async () => {
      try { setConfigs(await listSavedConfigs()); }
      catch { toast.error("Failed to fetch saved configs."); }
    })();
  }, [open]);

  /* ───────── FILTER / SORT ────── */
  useEffect(() => {
    let arr = Array.isArray(configs) ? [...configs] : [];
    if(query) arr = arr.filter(c => c.strategy.toLowerCase().includes(query.toLowerCase()));
    arr.sort(sortBy==="fields"
      ? (a,b)=>Object.keys(b.config).length - Object.keys(a.config).length
      : (a,b)=>a.strategy.localeCompare(b.strategy));
    setFiltered(arr);
  }, [configs, query, sortBy]);

  /* ───────── CRUD HELPERS ─────── */
  const handleLoad = (strategy,cfg) => {
    localStorage.setItem("lastStrategy",strategy);
    window.dispatchEvent(new CustomEvent("viewBotConfig",{detail:{mode:strategy,config:cfg}}));
    toast.success(`✅ Loaded ${strategy} config`); onClose();
  };

  const handleSave = async () => {
    if (!currentConfig || !mode) return;
    try {
      setLoading(true);
      const innerMode = currentConfig?.mode;
      const strategy  = mode==="scheduleLauncher" && innerMode && innerMode!=="scheduleLauncher"
                          ? innerMode : mode;

      const ALWAYS_EXCLUDE = [
        "botId","walletId","walletIds","wallet","wallets",
        "userId","mode","startTime","startedAt","status","pid","lastTickAt", "outputMint"
      ];
      const CONDITIONAL_EXCLUDE = ["buyMode"];  // only allowed on scheduler

      const keep = ([k]) =>
        !ALWAYS_EXCLUDE.includes(k) &&
        !(CONDITIONAL_EXCLUDE.includes(k) && strategy!=="scheduleLauncher");

      const pruned = Object.fromEntries(Object.entries(currentConfig).filter(keep));

      // Attach the optional note to the saved config. Note is stored on the
      // config object itself (within extras) so it doesn't affect runtime
      // behaviour. Empty notes are omitted.
      if (configNote?.trim()) {
        pruned.note = configNote.trim();
      }
      await saveConfig(strategy, pruned, configName);
      toast.success(`💾 Saved as ${strategy}`);
      setConfigs(await listSavedConfigs());
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to save config.");
    } finally {
      setLoading(false);
      // reset inputs when done
      setConfigName("");
      setConfigNote("");
    }
  };

  const handleDelete = async (id) => {
    try { await deleteSavedConfig(id);
      setConfigs(p => p.filter(c=>c.id!==id));
      toast.success("🗑 Deleted preset");
    } catch { toast.error("Failed to delete config."); }
  };

  /* ───────── EDIT HELPERS ─────── */
  const openEdit  = cfg => setEditing(cfg);
  const closeEdit = ()  => setEditing(null);

  const saveEdit = async () => {
    try {
      await editSavedConfig(editing.id, editing.config, editing.name);
      toast.success("✏️ Config updated");
      setConfigs(await listSavedConfigs());
      closeEdit();
    } catch (e) { toast.error(e.message); }
  };

  /** one-liner so we don't repeat markup  */
const L = (txt, tipKey = txt) => (
  <span className="flex items-center gap-1">
    {txt}
    <StrategyTooltip name={tipKey} />
  </span>
);

  /* ───────── FIELD RENDERER ───── */
  const Field = ({ k, v }) => {
      const [tempVal, setTempVal] = useState(v?.toString?.() ?? "");
    const wrap = "mt-4 flex flex-col";
    const label = "pb-1 flex items-center gap-1 text-[13px] font-medium text-zinc-400";
    const commonInput =
      "w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500";

    if (typeof v === "object" && v !== null) {
      return (
        <div key={k} className={wrap}>
          <label className={label}>{k}<Info size={12} className="text-zinc-500"/></label>
          <pre className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-white whitespace-pre-wrap">
            {JSON.stringify(v,null,2)}
          </pre>
        </div>
      );
    }

    const SAFETY_KEYS = [
  "authority",
  "liquidity",
  "simulation",
  "topHolders",
];

if (k.startsWith("safetyChecks.")) {
  const [, subKey] = k.split(".");
  const isFirst = subKey === Object.keys(editing.config?.safetyChecks || {})[0];

  return (
    <div key={k} className="mt-2">
{isFirst && (
  <label className="mb-1 flex items-center gap-1 px-1 pt-2 text-xs font-semibold text-zinc-400">
    {L("Safety Checks", "safetyChecks")}
  </label>
)}
<div className="flex items-center justify-between gap-4 px-1 pb-1 text-xs font-medium text-zinc-300">
  <span className="flex items-center gap-1">
    {L(subKey)}
  </span>
        <span
          className={`inline-flex h-5 w-10 items-center rounded-full transition ${
            editing.config.safetyChecks?.[subKey] ? "bg-emerald-500" : "bg-zinc-600"
          }`}
          role="switch"
          aria-checked={editing.config.safetyChecks?.[subKey]}
          onClick={() =>
            setEditing((p) => ({
              ...p,
              config: {
                ...p.config,
                safetyChecks: {
                  ...p.config.safetyChecks,
                  [subKey]: !p.config.safetyChecks?.[subKey],
                },
              },
            }))
          }
        >
          <span
            className={`h-4 w-4 transform rounded-full bg-white transition ${
              editing.config.safetyChecks?.[subKey] ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </span>
      </div>
    </div>
  );
}
if (SAFETY_KEYS.includes(k)) {
  return (
    <div key={k} className={wrap}>
      <label className="flex items-center justify-between gap-4 px-1 pb-1 text-xs font-medium text-zinc-300">
{L(k)}
        <span
          className={`inline-flex h-5 w-10 items-center rounded-full transition ${
            editing.config[k] ? "bg-emerald-500" : "bg-zinc-600"
          }`}
          role="switch"
          aria-checked={editing.config[k]}
          onClick={() =>
            setEditing((p) => ({
              ...p,
              config: { ...p.config, [k]: !p.config[k] },
            }))
          }
        >
          <span
            className={`h-4 w-4 transform rounded-full bg-white transition ${
              editing.config[k] ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </span>
      </label>
    </div>
  );
}


if (typeof v === "boolean") {
  return (
    <div key={k} className={wrap}>
      <label className="flex items-center justify-between gap-4 px-1 pb-1 text-xs font-medium text-zinc-300">
        <span className="flex items-center gap-1">{L(k)}</span>
        <span
          className={`inline-flex h-5 w-10 items-center rounded-full transition ${
            editing.config[k] ? "bg-emerald-500" : "bg-zinc-600"
          }`}
          role="switch"
          aria-checked={editing.config[k]}
          onClick={() =>
            setEditing((p) => ({
              ...p,
              config: { ...p.config, [k]: !p.config[k] },
            }))
          }
        >
          <span
            className={`h-4 w-4 transform rounded-full bg-white transition ${
              editing.config[k] ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </span>
      </label>
    </div>
  );
}
    // Special dropdown for mevMode
if (k === "mevMode") {
  return (
    <div key={k} className={wrap}>
<label className={label}>{L("mevMode")}</label>
      <select
        value={editing.config[k]}
        onChange={(e) =>
          setEditing((prev) => ({
            ...prev,
            config: { ...prev.config, [k]: e.target.value },
          }))
        }
        className={`${commonInput} cursor-pointer`}
      >
        <option value="fast">⚡ fast — fast finality</option>
        <option value="secure">🛡 secure — MEV protected</option>
      </select>
    </div>
  );
}

// inside Field
if (!isNaN(+v)) {
    return (
      <div key={k} className={wrap}>
<label className={label}>{L(k)}</label>

        <input
          type="number"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onBlur={() => {
            setEditing((prev) => ({
              ...prev,
              config: {
                ...prev.config,
                [k]: tempVal === "" ? 0 : +tempVal,
              },
            }));
          }}
          className={commonInput}
        />
      </div>
    );
  }

    /* string dropdown with custom fallback */
    const baseList = Array.isArray(configs) ? configs : [];
    const opts=[...new Set(baseList.map(c=>c?.config?.[k]).filter(s=>typeof s==="string"&&s.trim()))];
    if (editing.config[k] && !opts.includes(editing.config[k])) opts.unshift(editing.config[k]);

    return (
      <div key={k} className={wrap}>
        <label className={label}>{k}<Info size={12} className="text-zinc-500"/></label>
        <select
          value={opts.includes(editing.config[k]) ? editing.config[k] : "__custom"}
          onChange={e=>{
            const val=e.target.value;
            if(val==="__custom") return;
            setEditing(p=>({...p,config:{...p.config,[k]:val}}));
          }}
          className={`${commonInput} cursor-pointer`}
        >
          {opts.map(o=>(
            <option key={o} value={o}>{o}</option>
          ))}
          <option value="__custom">Custom…</option>
        </select>
        {(!opts.length || !opts.includes(editing.config[k])) && (
          <input
            type="text"
            value={editing.config[k] || ""}
            onChange={e=>setEditing(p=>({...p,config:{...p.config,[k]:e.target.value}}))}
            placeholder="Enter custom value"
            className={`${commonInput} mt-2`}
          />
        )}
      </div>
    );
  };

  /* ───────── GROUP FIELDS ─────── */
  const sectionOf = (k,strat) => {
    if (CONFIG_FIELDS.includes(k))               return "Config Settings";
    if (TP_FIELDS.includes(k))                   return "TP/SL";
    if (ADV_FIELDS.includes(k))                  return "Advanced Settings";
    if (STRAT_EXTRAS[strat]?.includes(k))        return "Strategy Settings";
    return "Other";
  };

const grouped = editing ? Object.entries(editing.config).reduce((a, [k, v]) => {
  const sec = sectionOf(k, editing.strategy);

  if (k === "safetyChecks" && typeof v === "object") {
    for (const [subKey, subVal] of Object.entries(v)) {
      const compoundKey = `safetyChecks.${subKey}`;
      (a[sec] ||= []).push([compoundKey, subVal]);
    }
  } else {
    (a[sec] ||= []).push([k, v]);
  }

  return a;
}, {}) : {};

  /* ───────── UI ───────── */
  return (
    <>
      {/* Main list modal (unchanged from prior versions) */}
      <Dialog open={open} onClose={onClose} className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-screen items-center justify-center bg-black/60 px-4">
          <Dialog.Panel
            as={motion.div}
            initial={{scale:0.95,opacity:0}}
            animate={{scale:1,opacity:1}}
            className="w-full max-w-2xl space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900/95 p-6 shadow-2xl backdrop-blur-md"
          >
            {/* header */}
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="flex items-center gap-2 text-lg font-bold text-white">
                <BarChart3 size={18} className="text-emerald-400"/> Saved Configs
              </Dialog.Title>
              <div className="flex items-center gap-2">
                <input
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Search strategy…"
                  value={query}
                  onChange={e=>setQuery(e.target.value)}
                />
                <select
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={sortBy}
                  onChange={e=>setSortBy(e.target.value)}
                >
                  <option value="name">Name</option>
                  <option value="fields">Field Count</option>
                </select>
              </div>
            </div>

            {/* list */}
            {/*
              Extend the height of the configs list so users can see more saved
              configurations at once. The original height only allowed
              approximately one and a half cards to appear without scrolling.
              Increase it to ~480px to comfortably show roughly three cards on
              most displays. Keeping overflow-y-auto preserves scroll
              behaviour for longer lists.
            */}
            <div className="max-h-[480px] space-y-6 overflow-y-auto pr-1">
              {Object.entries(groupConfigs(filtered)).map(([strategy,list])=>(
                <div key={strategy}>
                  <p className="mb-1 text-xs font-semibold text-zinc-500">
                    {STRAT_LABELS[strategy] || strategy} ({list.length})
                  </p>
                  <div className="space-y-2">
                    {list.map(c=>(
                      <SavedConfigCard
                        key={c.id}
                        config={c}
                        onLoad   ={()=>handleLoad(c.strategy,c.config)}
                        onDelete ={()=>handleDelete(c.id)}
                        onViewDetails={()=>setViewing(c)}
                        onEdit={()=>openEdit(c)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* save current */}
            <div className="border-t border-zinc-700 pt-4">
              {/* Name field for saved configuration */}
              <input
                className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Optional config name…"
                value={configName}
                onChange={e => setConfigName(e.target.value)}
              />
              {/* Optional note field – stores arbitrary text alongside the preset
                  for personal reference. It does not affect runtime behaviour. */}
              <textarea
                className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                rows={3}
                placeholder="Optional note (for your reference)…"
                value={configNote}
                onChange={e => setConfigNote(e.target.value)}
              />
              <button
                onClick={handleSave}
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save size={16} className="mr-2 inline"/> Save Current Config
              </button>
            </div>

            <button
              onClick={onClose}
              className="mt-4 w-full text-sm text-zinc-400 underline hover:text-white"
            >Close</button>
          </Dialog.Panel>
        </div>

        {/* details viewer */}
        <ViewFullConfigModal
          open={!!viewing}
          onClose={()=>setViewing(null)}
          config={viewing}
        />
      </Dialog>

      {/* Edit modal */}
      {editing && (
        <Dialog open onClose={closeEdit} className="fixed inset-0 z-50">
          <div className="flex min-h-screen items-center justify-center bg-black/60 px-4">
            <Dialog.Panel
              as={motion.div}
              initial={{y:20,opacity:0}} animate={{y:0,opacity:1}}
              className="w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900/95 p-6 shadow-2xl backdrop-blur-md"
            >
              {/* title + name */}
              <div className="space-y-3">
                <Dialog.Title className="flex items-center gap-2 text-lg font-bold text-white">
                  <Edit2 size={18}/> Edit Saved Config – {editing.strategy}
                </Dialog.Title>
                {/* Name input */}
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={editing.name || ""}
                  onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name (optional)"
                />
                {/* Note input for editing the optional note. The note lives on the
                    config object itself (extras.note) and is saved when the
                    preset is updated. */}
                <textarea
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                  rows={3}
                  value={editing.config?.note || ""}
                  onChange={e => setEditing(p => ({
                    ...p,
                    config: { ...p.config, note: e.target.value },
                  }))}
                  placeholder="Optional note (not used by bot)"
                />
              </div>

              {/* grouped fields */}
              <div className="max-h-[480px] overflow-y-auto pr-1">
                {SECTION_ORDER.map(section=>{
                  const items=grouped[section]||[];
                  if(!items.length) return null;
                  return(
                    <div key={section} className="mt-6 first:mt-0">
                      <p className="mb-2 text-sm font-bold text-zinc-300">{section}</p>
                      {items.map(([k,v])=><Field key={k} k={k} v={v}/>)}
                    </div>
                  );
                })}
              </div>

              {/* actions */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={closeEdit}
                  className="rounded-lg bg-zinc-700 px-5 py-2 text-sm text-white hover:bg-zinc-600"
                >Cancel</button>
                <button
                  onClick={saveEdit}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >Save</button>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      )}
    </>
  );
}

/* --------------- helpers --------------- */
const STRAT_LABELS = {
  sniper:"🔫 Sniper", scalper:"⚡ Scalper", breakout:"🚀 Breakout", chadMode:"🔥 Chad Mode",
  dipBuyer:"💧 Dip Buyer", delayedSniper:"⏱️ Delayed Sniper", trendFollower:"📈 Trend Follower",
  paperTrader:"📝 Paper Trader", rebalancer:"⚖️ Rebalancer", rotationBot:"🔁 Rotation Bot",
  stealthBot:"🥷 Stealth Bot", scheduleLauncher:"📆 Scheduler",
};

function groupConfigs(arr=[]) {
  return arr.reduce((acc,item)=>{
    (acc[item.strategy] ||= []).push(item);
    return acc;
  },{});
}
