// frontend/components/Controls/BotControls.jsx
//------------------------------------------------
// Start / Stop / Auto-Restart / Schedule badge cluster
//------------------------------------------------

import React           from "react";
import { motion }      from "framer-motion";
import { Switch }      from "@/components/ui/switch";
import { BarChart3 }   from "lucide-react";
import BotStatusButton from "./BotStatusButton";

const BotControls = ({
  disabled,
  running,
  onStart,
  onStop,
  autoRestart,
  setAutoRestart,
  currentMode,
  botLoading,
  hasSchedule,   // ⏰ props injected from parent (see below)
  countdown,     //
  className = "",
}) => (
  <div
    className={`flex flex-col gap-4 w-full bg-zinc-900/50 pt-3 pb-3 px-[30px]

                rounded-lg shadow-md border border-zinc-700 ${className}`}
    style={{ transform: "translateY(16px)" }}
  >
    {/* ───── Start / Stop ───── */}
    <motion.button
      onClick={botLoading ? null : onStart}
      disabled={disabled}
      className={`w-full min-w-[8rem] bg-emerald-600 hover:bg-emerald-700
                  text-white py-2 gap-2 rounded transition-transform hover:scale-105
                  shadow-md shadow-emerald-400/10 ${
                    disabled ? "opacity-50 cursor-not-allowed" : ""
                  }`}
    >
      {botLoading ? "Starting…" : "Start Bot"}
    </motion.button>

    <BotStatusButton
      trigger={
        <motion.button
          onClick={!running || botLoading ? null : onStop}
          disabled={!running || botLoading}
          className="w-full bg-red-600 hover:bg-red-700 text-white pt- py-2 rounded
                     disabled:opacity-50 gap-2 transition-transform hover:scale-105 shadow-md"
        >
          {botLoading ? "Stopping…" : "Stop Bot"}
        </motion.button>
      }
    />

    {/* ── Running bots quick-link ── */}
    <button
      onClick={() =>
        window.dispatchEvent(new CustomEvent("openBotStatusModal"))
      }
      className={`mx-auto flex items-center justify-center gap-1 
                  text-emerald-300 hover:text-white hover:bg-zinc-800/60
                  text-[12px] px-2 py-[3px] rounded transition-colors
                  ${running ? "animate-pulse bg-emerald-600/50" : ""}`}
    >
      <BarChart3 size={12} strokeWidth={2} />
      Running bots
    </button>

    {/* ⏰ Schedule badge
    {hasSchedule && !running && (
      <span className="inline-flex items-center justify-center w-full min-w-[8rem]
                       gap-1 bg-orange-600/20 border border-orange-500
                       text-orange-300 font-semibold py-[6px] rounded animate-pulse">
        ⏳ Scheduled — starts in {countdown}
      </span>
    )} */}

    {/* ───── Auto-Restart toggle ───── */}
    <label
      className={`flex items-center gap-3 pl-1 text-xs relative group cursor-help
                  ${
                    autoRestart
                      ? "text-emerald-400 font-semibold"
                      : "text-zinc-300"
                  }`}
    >
      <div className="absolute bottom-full mb-1 left-0 z-10 hidden group-hover:flex
                      bg-zinc-900 text-zinc-300 text-xs px-2 py-w rounded shadow-lg
                      border border-zinc-700 w-[180px]">
        Automatically restarts the bot if it stops or errors.
      </div>

      <Switch
        checked={autoRestart}
        onCheckedChange={setAutoRestart}
        className={autoRestart ? "ring-emerald-400 ring-2 glow" : ""}
      />
      Auto-Restart
    </label>
  </div>
);

export default BotControls;
