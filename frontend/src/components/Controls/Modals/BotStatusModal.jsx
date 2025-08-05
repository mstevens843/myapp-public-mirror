import React, { useState, useMemo } from "react";
import RunningBotCard from "./RunningBotCard";
import ViewFullRunningModal from "./ViewFullRunningModal";
import { Listbox } from "@headlessui/react"; 
import {
    XCircle,
  PauseCircle,
  PlayCircle,
  Trash2,
  BarChart3,
  RefreshCw,
  Filter,
  ArrowUp01,
  ArrowDown01,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner"; 

/* (emoji list unchanged) */
const STRATEGY_OPTIONS = [
  { value: "sniper",         label: "🔫 Sniper" },
  { value: "scalper",        label: "⚡ Scalper" },
  { value: "breakout",       label: "🚀 Breakout" },
  { value: "chadMode",       label: "🔥 Chad Mode" },
  { value: "dipBuyer",       label: "💧 Dip Buyer" },
  { value: "delayedSniper",  label: "⏱️ Delayed Sniper" },
  { value: "trendFollower",  label: "📈 Trend Follower" },
  { value: "paperTrader",    label: "📝 Paper Trader" },
  { value: "rebalancer",     label: "⚖️ Rebal     ancer" },
  { value: "rotationBot",    label: "🔁 Rotation Bot" },
    { value: "stealthBot",    label: "🥷 Stealth Bot" },

];
const getStrategyLabel = (m) =>
  STRATEGY_OPTIONS.find((s) => s.value === m)?.label ?? m;

export default function BotStatusModal({
    open,
  onClose,
  data,
  onPause,
  onResume,
  onDelete,
  onPauseAll,
  onRefresh,
}) {
  if (!open || !data) return null;

  /* 🍱 new shape */
  const { botIds = [], botCfgs = {} } = data;

  const [viewingBot, setViewingBot] = useState(null);

  /* ─── sort helpers ─── */
  const [sortBy, setSortBy] = useState("name"); // name | uptime
  const [asc, setAsc]       = useState(true);

  const sortedIds = useMemo(() => {
  const arr = [...botIds];
    arr.sort((a, b) => {
      if (sortBy === "name") {                 // name = mode label
      return asc
        ? botCfgs[a].mode.localeCompare(botCfgs[b].mode)
        : botCfgs[b].mode.localeCompare(botCfgs[a].mode);
     }
     const ua = botCfgs[a]?.uptimeRaw ?? 0;
     const ub = botCfgs[b]?.uptimeRaw ?? 0;
      return asc ? ua - ub : ub - ua;
    });
    return arr;
  }, [botIds, sortBy, asc, botCfgs]);


  /* ─── UI ─── */
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-lg p-5 shadow-xl relative text-white"
      >
        {/* header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart3 size={18} className="text-emerald-400" />
            Active Bot Status
          </h2>

          <div className="flex items-center gap-2 text-xs">
            {/* sort / order */}
            <div className="flex items-center gap-1 text-green-400">
              <Filter size={14} />
              <div className="relative text-left">
              <Listbox value={sortBy} onChange={setSortBy}>
                <div className="relative">
                  <Listbox.Button className="flex items-center gap-1 bg-zinc-800 px-2 py-1 text-sm rounded-md hover:bg-zinc-700 border border-zinc-600 text-zinc-200">
                    {sortBy === "name" ? "Name" : "Uptime"}
                  </Listbox.Button>

                  <Listbox.Options className="absolute z-10 mt-1 w-32 bg-zinc-800 border border-zinc-600 rounded-md shadow-lg text-sm text-zinc-200">
                    <Listbox.Option
                      value="name"
                      className={({ active }) =>
                        `px-3 py-1 cursor-pointer ${
                          active ? "bg-zinc-700 text-white" : "text-zinc-200"
                        }`
                      }
                    >
                      Name
                    </Listbox.Option>
                    <Listbox.Option
                      value="uptime"
                      className={({ active }) =>
                        `px-3 py-1 cursor-pointer ${
                          active ? "bg-zinc-700 text-white" : "text-zinc-200"
                        }`
                      }
                    >
                      Uptime
                    </Listbox.Option>
                  </Listbox.Options>
                </div>
              </Listbox>
            </div>

              <button
                onClick={() => setAsc((v) => !v)}
                className="hover:text-white"
                title="Toggle sort order"
              >
                {asc ? <ArrowUp01 size={14} /> : <ArrowDown01 size={14} />}
              </button>
            </div>

            {/* pause-all */}
             {botIds.length > 0 && (
               <button onClick={() => onPauseAll?.(botIds)}
                className="flex items-center gap-1 text-yellow-400 hover:text-yellow-500"
                title="Pause all running bots"
              >
                <PauseCircle size={16} />
                Pause&nbsp;All
              </button>
            )}

            {/* refresh */}
            <button
              onClick={async () => {
                try {
                  const { fetchDetailedStatus } = await import("@/utils/autobotApi");
                  onRefresh?.(await fetchDetailedStatus());
                } catch {
                  toast.error("❌ Refresh failed");
                }
              }}
              className="text-cyan-400"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>

            <button
              onClick={onClose}
              className="text-red-400 hover:text-white"
              aria-label="Close"
            >
              <XCircle size={20} />
            </button>
          </div>
        </div>

        {/* body */}
        {botIds.length === 0 ? (
          <p className="text-zinc-400 italic">No bots currently running.</p>
        ) : (
          <div className="space-y-4">
            {sortedIds.map((botId) => {
              const cfg = botCfgs[botId] || {};
              const mode = cfg.mode;
              return (
                <RunningBotCard
                  key={botId}
                  mode={mode}
                  botId={cfg.botId}
                  uptime={cfg.uptime}
                  restartCount={cfg.restartCount}
                  tickAgo={cfg.lastTickAgo}
                  tickRaw={cfg.lastTickAgoRaw}
                  config={cfg.config}
                  onStop={() => onStop(mode)}
                  isPaused={cfg.isPaused}       
                  onPause={() => onPause(botId)}
                  onResume={() => onResume(botId)}
                  onDelete={() => onDelete(botId)}  
                  tradesExecuted={cfg.tradesExecuted}
                  maxTrades={cfg.maxTrades} 
                  onView={() =>
                    setViewingBot({ mode, config: cfg.config })
                  }
                  onViewLogs={() => {
                      if (cfg.botId) {
                       window.dispatchEvent(
                         new CustomEvent("setLogsTarget", {
                           detail: {
                             botId   : cfg.botId,
                             strategy: cfg.mode,
                             config  : cfg.config,
                             returnAfter: true,        // 🆕 tell App we came from the modal
                           },
                         }),
                       );
                      toast.success(`🧠 Switched logs to ${getStrategyLabel(mode)}`);
                    }
                    onClose();
                  }}
                />
              );
            })}
          </div>
        )}
      </motion.div>

      {/* per-bot full-config viewer */}
      <ViewFullRunningModal
        open={!!viewingBot}
        onClose={() => setViewingBot(null)}
        config={{
          strategy: viewingBot?.mode,
          config: viewingBot?.config,
          name: `${viewingBot?.mode} Bot`,
        }}
      />
    </div>
  );
}
