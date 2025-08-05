// FloatingBotBeacon.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  LogIn, TerminalSquare, Settings, X, ChevronDown, Bot, Zap,
  TrendingUp, RotateCcw, Target, FileText
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const STRATEGIES = {
  sniper: { label: "Sniper", emoji: "🔫", icon: Target },
  scalper: { label: "Scalper", emoji: "⚡", icon: Zap },
  breakout: { label: "Break-out", emoji: "🚀", icon: TrendingUp },
  chadMode: { label: "Chad Mode", emoji: "🔥", icon: Bot },
  dipBuyer: { label: "Dip Buyer", emoji: "💧", icon: RotateCcw },
  delayedSniper: { label: "Delay Sniper", emoji: "⏱️", icon: Target },
  trendFollower: { label: "Trend Follow", emoji: "📈", icon: TrendingUp },
  paperTrader: { label: "Paper Trader", emoji: "📝", icon: FileText },
  rebalancer: { label: "Rebalancer", emoji: "⚖️", icon: RotateCcw },
  rotationBot: { label: "Rotation Bot", emoji: "🔁", icon: Bot },
  stealthBot: { label: "Stealth Bot", emoji: "🥷", icon: Bot },
};

// ✅ FIXED: Moved outside to avoid hook mismatch
const StrategyChip = ({ mode }) => {
  const data = STRATEGIES[mode] ?? {};
  const Icon = data.icon || Bot;
  return (
    <div className="flex items-center gap-1 bg-zinc-800/60 px-2 py-0.5 rounded text-xs">
      <Icon className="h-3 w-3 -ml-0.5" />
      <span>{data.label || mode}</span>
    </div>
  );
};

const FloatingBotBeacon = ({ runningBots = [], onOpenLogs, onOpenManageBots, onOpenConfig }) => {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [showBeacon, setShowBeacon] = useState(true);
  const listRef = useRef(null);

  const primaryBot = runningBots[0];
  const extraCount = Math.max(runningBots.length - 1, 0);

  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [runningBots.length, open]);

  // ✅ Prevent UI but keep hooks stable
  if (!primaryBot && !showBeacon) return null;

  if (!showBeacon) {
    return (
      <div
        className="fixed bottom-4 right-4 z-[998] cursor-pointer group"
        onClick={() => setShowBeacon(true)}
        title="Open Bot Beacon"
      >
        <div className="relative flex h-3.5 w-3.5">
          <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-400" />
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        key="floating-beacon"
        initial={{ y: 40, opacity: 0, scale: 0.92 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0, scale: 0.92 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="fixed bottom-4 right-4 z-[999] w-[290px] sm:w-[280px] bg-zinc-900/80 backdrop-blur border border-transparent hover:border-emerald-400/60 rounded-2xl shadow-lg"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(34,34,34,.9) 0%, rgba(18,18,18,.9) 100%)",
        }}
      >
        <div className="absolute inset-0 rounded-2xl pointer-events-none ring-1 ring-emerald-400/20" />

        <div className="flex items-center justify-between pl-4 pr-2 py-3 relative">
          {/* glow dot */}
          <span className="relative flex h-3 w-3">
            <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
          </span>

          {/* label */}
          <div className="flex items-center gap-2">
            <StrategyChip mode="sniper" />
            <span className="text-zinc-400 text-xs">· {runningBots.length}</span>
            {extraCount > 0 && (
              <span className="text-xs text-zinc-400 font-medium">
                +{extraCount} more
              </span>
            )}
          </div>

          {/* controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOpen((p) => !p)}
              className="text-zinc-400 hover:text-emerald-300 transition"
              title={open ? "Collapse" : "Expand"}
            >
              <ChevronDown
                className={`h-4 w-4 transform transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>
            <button
              onClick={() => setShowBeacon(false)}
              className="text-zinc-500 hover:text-red-400 transition"
              title="Hide"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {open && (
          <motion.div
            key="bot-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="border-t border-zinc-800/60"
          >
            <div
              ref={listRef}
              className="max-h-[190px] overflow-y-auto p-3 space-y-2 pr-4 scrollbar-thin scrollbar-thumb-zinc-700/70 scrollbar-thumb-rounded"
            >
              {runningBots.map((b) => {
                const emoji = STRATEGIES[b.mode]?.emoji ?? "🤖";
                const shortId = `${b.mode}-${b.botId.slice(-4)}`;
                const elapsed = fmt(b.uptimeRaw ?? 0);
                return (
                  <div
                    key={b.botId}
                    className="flex items-center justify-between bg-zinc-800/50 px-2 py-1.5 rounded text-zinc-200 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate max-w-[200px]">
                      {emoji} {shortId}
                      <span className="text-emerald-300">{elapsed}</span>
                      {b.maxTrades && (
                        <span className="text-zinc-400">
                          {b.tradesExecuted}/{b.maxTrades}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        <div className="flex justify-between gap-2 p-3 pt-2">
          <button
            onClick={() => onOpenLogs?.(primaryBot)}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-sm px-2.5 py-1 rounded transition"
          >
            <LogIn size={14} /> Logs
          </button>
          <button
            onClick={onOpenManageBots}
            className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 py-1 rounded transition"
          >
            <TerminalSquare size={14} /> Manage
          </button>
          {onOpenConfig && (
            <button
              onClick={onOpenConfig}
              className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 py-1 rounded transition"
            >
              <Settings size={14} /> Config
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


export default FloatingBotBeacon; 








// version of BEacon that allows you to drag around the screen. disspears sometimes. Need to tweak 
// May asdd back later


// import React, { useState, useEffect, useRef } from "react";
// import {
//   LogIn, TerminalSquare, Settings, X, ChevronDown, Bot, Zap,
//   TrendingUp, RotateCcw, Target, FileText
// } from "lucide-react";
// import { motion, AnimatePresence } from "framer-motion";

// const fmt = (ms) => {
//   const s = Math.floor(ms / 1000);
//   return `${Math.floor(s / 60)}m ${s % 60}s`;
// };

// const STRATEGIES = {
//   sniper: { label: "Sniper", emoji: "🔫", icon: Target },
//   scalper: { label: "Scalper", emoji: "⚡", icon: Zap },
//   breakout: { label: "Break-out", emoji: "🚀", icon: TrendingUp },
//   chadMode: { label: "Chad Mode", emoji: "🔥", icon: Bot },
//   dipBuyer: { label: "Dip Buyer", emoji: "💧", icon: RotateCcw },
//   delayedSniper: { label: "Delay Sniper", emoji: "⏱️", icon: Target },
//   trendFollower: { label: "Trend Follow", emoji: "📈", icon: TrendingUp },
//   paperTrader: { label: "Paper Trader", emoji: "📝", icon: FileText },
//   rebalancer: { label: "Rebalancer", emoji: "⚖️", icon: RotateCcw },
//   rotationBot: { label: "Rotation Bot", emoji: "🔁", icon: Bot },
//   stealthBot: { label: "Stealth Bot", emoji: "🥷", icon: Bot },
// };

// const getInitialPosition = () => {
//   try {
//     const saved = JSON.parse(localStorage.getItem("botBeaconPos"));
//     const winW = window.innerWidth;
//     const winH = window.innerHeight;
//     if (
//       saved &&
//       typeof saved.left === "number" &&
//       typeof saved.top === "number" &&
//       saved.left >= 0 &&
//       saved.left <= winW - 100 &&
//       saved.top >= 0 &&
//       saved.top <= winH - 100
//     ) {
//       return saved;
//     }
//   } catch {}
//   return { top: window.innerHeight - 180, left: window.innerWidth - 320 };
// };

// export default function FloatingBotBeacon({
//   runningBots = [],
//   onOpenLogs,
//   onOpenManageBots,
//   onOpenConfig,
// }) {
//   const [, force] = useState(0);
//   const [open, setOpen] = useState(false);
//   const [showBeacon, setShowBeacon] = useState(true);
//   const [position, setPosition] = useState(getInitialPosition);
//   const listRef = useRef(null);

//   useEffect(() => {
//     const id = setInterval(() => force((v) => v + 1), 1000);
//     return () => clearInterval(id);
//   }, []);

//   useEffect(() => {
//     if (open && listRef.current) {
//       listRef.current.scrollTop = listRef.current.scrollHeight;
//     }
//   }, [runningBots.length, open]);

//   useEffect(() => {
//   const reset = (e) => {
//     if (e.key.toLowerCase() === "b" && e.shiftKey) {
//       console.log("🔄 Resetting Bot Beacon position");
//       const fallback = { top: window.innerHeight - 180, left: window.innerWidth - 320 };
//       setPosition(fallback);
//       localStorage.setItem("botBeaconPos", JSON.stringify(fallback));
//       setShowBeacon(true);
//     }
//   };
//   window.addEventListener("keydown", reset);
//   return () => window.removeEventListener("keydown", reset);
// }, []);

// const savePos = (event, info) => {
//   const winW = window.innerWidth;
//   const winH = window.innerHeight;

//   // Use cursor location to decide snap
//   const { x, y } = info.point;

//   const snapPadding = 20; // distance from edges
//   let newTop = y < winH / 2 ? snapPadding : winH - 140;  // 140 ~ beacon height
//   let newLeft = x < winW / 2 ? snapPadding : winW - 300; // 300 ~ beacon width

//   const newPos = { top: newTop, left: newLeft };
//   setPosition(newPos);
//   localStorage.setItem("botBeaconPos", JSON.stringify(newPos));
// };
//   const StrategyChip = ({ mode }) => {
//     const data = STRATEGIES[mode] ?? {};
//     const Icon = data.icon || Bot;
//     return (
//       <div className="flex items-center gap-1 bg-zinc-800/60 px-2 py-0.5 rounded text-xs">
//         <Icon className="h-3 w-3 -ml-0.5" />
//         <span>{data.label || mode}</span>
//       </div>
//     );
//   };

//   const primaryBot = runningBots[0];
//   const extraCount = Math.max(runningBots.length - 1, 0);
//   if (!primaryBot) return null;

//   return (
//     <>
//       {/* Mini Dot (when dismissed) */}
//       {!showBeacon && (
//         <motion.div
//           drag
//           onDragEnd={savePos}
//           dragMomentum={false}
//           style={{ top: position.top, left: position.left, position: "fixed" }}
//           className="z-[998] cursor-pointer group"
//           onClick={() => setShowBeacon(true)}
//           title="Open Bot Beacon"
//         >
//           <div className="relative flex h-3.5 w-3.5">
//             <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
//             <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-400" />
//           </div>
//         </motion.div>
//       )}

//       {/* Full Beacon */}
//       <AnimatePresence>
//         {showBeacon && (
//           <motion.div
//             key="floating-beacon"
//             drag
//             onDragEnd={savePos}
//             dragMomentum={false}
//             style={{ top: position.top, left: position.left, position: "fixed" }}
//             className="z-[999] w-[290px] sm:w-[280px] bg-zinc-900/80 backdrop-blur border border-transparent hover:border-emerald-400/60 rounded-2xl shadow-lg"
//             initial={{ opacity: 0, scale: 0.92 }}
//             animate={{ opacity: 1, scale: 1 }}
//             exit={{ opacity: 0, scale: 0.92 }}
//             transition={{ type: "spring", stiffness: 260, damping: 22 }}
//           >
//             <div className="absolute inset-0 rounded-2xl pointer-events-none ring-1 ring-emerald-400/20" />

//             {/* Header */}
//             <div className="flex items-center justify-between pl-4 pr-2 py-3 relative cursor-move">
//               <span className="relative flex h-3 w-3">
//                 <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
//                 <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
//               </span>

//               <div className="flex items-center gap-2">
//                 <StrategyChip mode="sniper" />
//                 <span className="text-zinc-400 text-xs">· {runningBots.length}</span>
//                 {extraCount > 0 && (
//                   <span className="text-xs text-zinc-400 font-medium">+{extraCount} more</span>
//                 )}
//               </div>

//               <div className="flex items-center gap-1">
//                 <button
//                   onClick={() => setOpen((p) => !p)}
//                   className="text-zinc-400 hover:text-emerald-300 transition"
//                   title={open ? "Collapse" : "Expand"}
//                 >
//                   <ChevronDown
//                     className={`h-4 w-4 transform transition-transform ${
//                       open ? "rotate-180" : ""
//                     }`}
//                   />
//                 </button>
//                 <button
//                   onClick={() => setShowBeacon(false)}
//                   className="text-zinc-500 hover:text-red-400 transition"
//                   title="Hide"
//                 >
//                   <X className="h-4 w-4" />
//                 </button>
//               </div>
//             </div>

//             {/* List */}
//             {open && (
//               <motion.div
//                 key="bot-list"
//                 initial={{ height: 0, opacity: 0 }}
//                 animate={{ height: "auto", opacity: 1 }}
//                 exit={{ height: 0, opacity: 0 }}
//                 transition={{ duration: 0.25 }}
//                 className="border-t border-zinc-800/60"
//               >
//                 <div
//                   ref={listRef}
//                   className="max-h-[190px] overflow-y-auto p-3 space-y-2 pr-4 scrollbar-thin scrollbar-thumb-zinc-700/70 scrollbar-thumb-rounded"
//                 >
//                   {runningBots.map((b) => {
//                     const emoji = STRATEGIES[b.mode]?.emoji ?? "🤖";
//                     const shortId = `${b.mode}-${b.botId.slice(-4)}`;
//                     const elapsed = fmt(b.uptimeRaw ?? 0);
//                     return (
//                       <div
//                         key={b.botId}
//                         className="flex items-center justify-between bg-zinc-800/50 px-2 py-1.5 rounded text-zinc-200 text-xs"
//                       >
//                         <div className="flex items-center gap-2 truncate max-w-[200px]">
//                           {emoji} {shortId}
//                           <span className="text-emerald-300">{elapsed}</span>
//                           {b.maxTrades && (
//                             <span className="text-zinc-400">
//                               {b.tradesExecuted}/{b.maxTrades}
//                             </span>
//                           )}
//                         </div>
//                       </div>
//                     );
//                   })}
//                 </div>
//               </motion.div>
//             )}

//             {/* Footer */}
//             <div className="flex justify-between gap-2 p-3 pt-2">
//               <button
//                 onClick={() => onOpenLogs?.(primaryBot)}
//                 className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-sm px-2.5 py-1 rounded transition"
//               >
//                 <LogIn size={14} /> Logs
//               </button>
//               <button
//                 onClick={onOpenManageBots}
//                 className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 py-1 rounded transition"
//               >
//                 <TerminalSquare size={14} /> Manage
//               </button>
//               {onOpenConfig && (
//                 <button
//                   onClick={onOpenConfig}
//                   className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 py-1 rounded transition"
//                 >
//                   <Settings size={14} /> Config
//                 </button>
//               )}
//             </div>
//           </motion.div>
//         )}
//       </AnimatePresence>
//     </>
//   );
// }