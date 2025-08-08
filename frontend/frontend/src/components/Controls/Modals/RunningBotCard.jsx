import React from "react";
import { PauseCircle, PlayCircle, Trash2, Eye, TerminalSquare  } from "lucide-react";
import useBotHealth from "@/hooks/useBotHealth";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

const STRATEGY_LABELS = {
  sniper: "🔫 Sniper",
  scalper: "⚡ Scalper",
  breakout: "🚀 Breakout",
  chadMode: "🔥 Chad Mode",
  dipBuyer: "💧 Dip Buyer",
  delayedSniper: "⏱️ Delayed Sniper",
  trendFollower: "📈 Trend Follower",
  paperTrader: "📝 Paper Trader",
  rebalancer: "⚖️ Rebalancer",
  rotationBot: "🔁 Rotation Bot",
  stealthBot : "🥷 Stealth Bot",
};

const getStrategyLabel = (mode) => STRATEGY_LABELS[mode] || mode;

export default function RunningBotCard({
  mode,
  config = {},
  uptime,
  tickAgo,
  tickRaw,
  restartCount,
  onStop,
  isPaused = false,
  onPause,
  onResume,
  onDelete,
  onView,
 onViewLogs, 
 tradesExecuted,
  maxTrades,
  botId,

}) {
  const fieldCount = Object.values(config).filter(
    (v) => v !== null && v !== undefined && v !== ""
  ).length;

  // Fetch health metrics for this bot. If unavailable, fall back to
  // timing-based calculations from tickRaw.
  const health = useBotHealth(botId);
  const pulseClass = isPaused
    ? "bg-zinc-500"
    : health?.healthLevel === "green"
    ? "bg-green-400 animate-pulse"
    : health?.healthLevel === "yellow"
    ? "bg-yellow-400 animate-pulse"
    : health?.healthLevel === "red"
    ? "bg-red-500"
    : tickRaw < 60
    ? "bg-green-400 animate-pulse"
    : tickRaw < 180
    ? "bg-yellow-400 animate-pulse"
    : "bg-red-500";

  // Prefer restart count from health telemetry if available
  const effectiveRestartCount = health?.restartCount ?? restartCount;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="p-4 bg-zinc-800 rounded-md border border-zinc-700 shadow-inner"
    >
      {/* Top row */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold capitalize">
          <span className={`h-2 w-2 rounded-full ${pulseClass}`} />
          {getStrategyLabel(mode)}
        </div>

        <div className="flex items-center gap-3 text-sm">
          <button onClick={onView}      className="text-blue-400 hover:text-blue-500">
            <Eye size={16} /> View
          </button>
          <button onClick={onViewLogs} className="text-emerald-400 hover:text-emerald-500">
            <TerminalSquare size={16} /> Logs
          </button>

          {isPaused ? (
            <button onClick={onResume} className="text-green-400 hover:text-green-500">
              <PlayCircle size={16} /> Unpause          {/* 👉 label swap */}
            </button>
          ) : (
            <button onClick={onPause} className="text-yellow-400 hover:text-yellow-500">
              <PauseCircle size={16} /> Pause
            </button>
          )}

          <button onClick={onDelete} className="text-red-400 hover:text-red-500">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="text-xs text-zinc-300 space-y-1">
        <div className={`text-xs text-zinc-400 flex flex-wrap gap-2 font-mono ${pulseClass.replace("bg-", "text-")}`}>
          {isPaused ? (
            <span>[⏸️ paused]</span>
          ) : (
            <>
              <span>{tickRaw < 60 ? "🟢" : tickRaw < 180 ? "🟡" : "🔴"} {uptime}</span>
              <span>⏱️ {tickAgo}</span>
              <span>🔁 {effectiveRestartCount}x</span>
              {Number.isFinite(maxTrades) && (
                <span className="text-emerald-300">
                  🛒 {tradesExecuted}/{maxTrades}
                </span>
              )}
            </>
          )}
        </div>
        <p>
          💰 <strong>Amount:</strong> {config.amountToSpend ?? "?"} SOL
        </p>
        <p>
          ⏱ <strong>Interval:</strong>{" "}
          {config.interval ? config.interval / 1000 + "s" : "?"}
        </p>
        <p>
          🎯 <strong>TP:</strong> {config.takeProfit ?? "—"}% |{" "}
          <strong>SL:</strong> {config.stopLoss ?? "—"}%
        </p>
        <p className="text-zinc-500 italic">
          Config: {fieldCount} fields set
        </p>
      </div>
    </motion.div>
  );
}
