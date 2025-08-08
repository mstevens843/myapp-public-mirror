// src/components/StrategyConsoleSheet.jsx
//------------------------------------------------------------
//  A console / summary drawer that slides up from the bottom.
//  – Draggable vertical resize
//  – One-Dark-Pro aesthetics
//  – Breathing-room at the bottom so last log is visible
//------------------------------------------------------------

import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button }               from "@/components/ui/button";
import { useLogsStore }         from "../../state/LogsStore";
import useSingleLogsSocket      from "../../hooks/useSingleLogsSocket";
import { usePrevious }          from "@/hooks/usePrevious";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  TerminalSquare,
  FileDown,
  Trash2,
  GripVertical,
  NotebookText,
} from "lucide-react";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Listbox } from "@headlessui/react";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const LS_KEY = "solpulse.consoleHeight";
const labelFor = (b) => {
  if (!b || typeof b.botId !== "string") return "Unknown Bot";
  return `${b.mode} (${b.botId.slice(-4)})` + (b.paused ? " ⏸" : "");
};
/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */
export default function StrategyConsoleSheet({
  open,
  onClose,
  strategy,
  botId,
  onClearLogs,
  currentTab = "logs",

  /* 🆕 multi-bot props                       */
  bots       = [],                 // [{ botId, mode, paused }]
  onSwitchBot = () => {},
}) {
  const [selectedBot, setSelectedBot] = useState(() => {
  return bots.find((b) => b.botId === botId) || { botId, mode: strategy };
});

  /* — sockets / stores ------------------------------------------------ */
  useSingleLogsSocket();
  const allLogs = useLogsStore((s) => s.logs);

  /* — derived: logs for this bot ------------------------------------- */
  const logs = useMemo(
    () =>
      allLogs
        .filter((l) => l.botId === botId)
        .map((l) => (typeof l.text === "string" ? l.text : l.text ?? "")),
    [allLogs, botId]
  );

  /* — refs / state ---------------------------------------------------- */
  const bottomRef        = useRef(null);
  const prevBot          = usePrevious(botId);
  const [activeTab, setActiveTab] = useState(currentTab);

  /* --- glow on buy --------------------------------------------------- */
  const [glowTrigger, setGlowTrigger] = useState(false);

  /* --- summary history ---------------------------------------------- */
  const [summaryHistory, setSummaryHistory] = useState([]);
  const summaryRegex = /Tick #(\d+).*Scanned: (\d+), Filters: (\d+), Safety: (\d+), (?:Fully Passed|Bought): (\d+)/;

  /* --- height (resizable) ------------------------------------------- */
  const defaultH = Number(localStorage.getItem(LS_KEY)) || 500;
  const [height, setHeight] = useState(defaultH);
  const startY = useRef(null);

  const onDragStart = (e) => {
    e.preventDefault();
    startY.current = e.clientY;
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", onDragEnd);
  };
  const onDrag = useCallback(
    (e) => {
      const dy = startY.current - e.clientY;
      const newH = clamp(height + dy, 250, window.innerHeight * 0.9);
      startY.current = e.clientY;
      setHeight(newH);
    },
    [height]
  );
  const onDragEnd = () => {
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", onDragEnd);
    localStorage.setItem(LS_KEY, String(height));
  };

  /* ------------------------------------------------------------------ */
  /* Sync tab changes from parent                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (open) setActiveTab(currentTab);
  }, [open, currentTab]);

  /* ------------------------------------------------------------------ */
  /* Parse new logs  ➞ summaries / glow                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const newEntries = allLogs.filter((l) => l.botId === botId);
    if (!newEntries.length) return;

    setSummaryHistory((prev) => {
      let next = [...prev];
      newEntries.forEach(({ text }) => {
        if (typeof text !== "string") return;

        // 📊 Tick lines
        if (text.includes("📊 Tick") && summaryRegex.test(text)) {
          const [, tickId, scanned, filters, safety, passed] = summaryRegex
            .exec(text)
            .map(Number);
          next = [
            ...next,
            {
              timestamp: Date.now(),
              tickId,
              scanned,
              filters,
              safety,
              passed,
            },
          ].slice(-200);
        }

        // 🎆 Buy glow
        if (text.includes("[🎆 BOUGHT SUCCESS]")) {
          setGlowTrigger(true);
          setTimeout(() => setGlowTrigger(false), 1200);
        }
      });
      return next;
    });
  }, [allLogs, botId]);

  /* ------------------------------------------------------------------ */
  /* Auto-scroll when switching bot                                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!botId || prevBot === undefined || prevBot === botId) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  const match = bots.find((b) => b.botId === botId);
  if (match) setSelectedBot(match);
  }, [botId, prevBot]);

  /* ------------------------------------------------------------------ */
  /* Render helpers                                                     */
  /* ------------------------------------------------------------------ */
  const renderLog = (text, idx) => {
    let Icon = TerminalSquare,
      className = "text-zinc-300";
    if (text.includes("[ERROR]"))
      (Icon = XCircle), (className = "text-red-300");
    else if (text.includes("[WARN]"))
      (Icon = AlertTriangle), (className = "text-yellow-300");
    else if (text.includes("[INFO]"))
      (Icon = CheckCircle), (className = "text-green-300");
    else if (text.includes("[LOOP]"))
      (Icon = RotateCcw), (className = "text-blue-300");

    return (
      <div
        key={idx}
        className={`flex items-start gap-2 mb-[2px] break-words ${className}`}
      >
        <Icon className="h-4 w-4 shrink-0 mt-[2px]" />
        <span>{text}</span>
      </div>
    );
  };

  const renderSummary = () =>
    summaryHistory.length ? (
      <div className="space-y-3 px-1.5">
        {summaryHistory
          .slice()
          .reverse()
          .map((s, i) => (
            <div key={i} className="text-[13px] text-zinc-300">
              <span className="text-white mr-2 font-semibold">
                #{String(s.tickId).padStart(3, "0")} —{" "}
                {new Date(s.timestamp).toLocaleTimeString()}
              </span>
              Scanned: <span className="text-white">{s.scanned}</span> | Filters:{" "}
              <span className="text-emerald-400">{s.filters}</span> | Safety:{" "}
              <span className="text-emerald-400">{s.safety}</span> | Bought:{" "}
              <span className="text-emerald-500 font-bold">{s.passed}</span>
            </div>
          ))}
      </div>
    ) : (
      <div className="text-zinc-400 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        No summary data yet.
      </div>
    );

  /* Hide summary lines when on “Logs” */
  const visibleLogs =
    activeTab === "logs"
      ? logs.filter(
          (l) => !l.includes("📊 Tick") && !l.includes("[SUMMARY]")
        )
      : logs;

  /* ------------------------------------------------------------------ */
  /* JSX                                                                */
  /* ------------------------------------------------------------------ */
  return (
    <Sheet open={open} onOpenChange={onClose}>
<SheetContent
  side="bottom"
  className="w-full !p-0 z-50 [&>button[data-radix-dialog-close]]:hidden"
  style={{ height }}
>
        {/* ---------- resize handle ---------- */}
        <div
          onMouseDown={onDragStart}
          className="h-4 w-full flex items-center justify-center cursor-row-resize select-none bg-transparent"
        >
          <GripVertical className="h-4 w-4 text-zinc-600" />
        </div>

        {/* ---------- header ---------- */}
        <div
          className="
            bg-gradient-to-r from-[#1f2430] to-[#202634]
            border-t border-b border-zinc-800/60
            px-4 py-3
            flex items-start justify-between
          "
        >
     
          <h3 className="text-base font-semibold flex items-center gap-2">
            <TerminalSquare className="text-emerald-400 shrink-0" />
            <span>
              Strategy Console —{" "}
              <span className="capitalize text-zinc-300">
                {/* {strategy} ({botId}) */}
              </span>
            </span>
          <Listbox
            value={selectedBot}
            onChange={(b) => {
              setSelectedBot(b);
              onSwitchBot(b);
            }}
          >
            <div className="relative inline-block">
              {/* Button */}
              <Listbox.Button
                className="
                  capitalize text-zinc-200 bg-zinc-800/70
                  hover:bg-zinc-700 px-6 py-1 rounded-md text-sm
                  border border-zinc-600"
              >
                {labelFor(selectedBot)}
              </Listbox.Button>

              {/* Options */}
              <Listbox.Options
                className="
                  absolute z-20 mt-1 max-h-60 overflow-auto
                  bg-zinc-800 border border-zinc-600 rounded-md
                shadow-lg text-sm"
              >
                {bots.map((b) => (
                  <Listbox.Option
                    key={b.botId}
                    value={b}
                    className={({ active }) =>
                      `cursor-pointer px-6 py-1 ${
                        active ? "bg-zinc-700 text-white" : "text-zinc-200"
                      }`
                    }
                  >
                    {labelFor(b)}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>
        </h3>

          <button onClick={onClose} className="text-zinc-400 hover:text-red-400 transition" title="Close">
  <XCircle className="w-5 h-5" />
</button>
        </div>

        {/* ---------- toolbar ---------- */}
        <div className="flex flex-wrap gap-2 px-4 py-2 bg-zinc-900/95 border-b border-zinc-800/60"> 
          <Button
            size="sm"
            variant="outline"
                        className="text-cyan-500 hover:text-white"
            onClick={() => {
              const blob = new Blob([logs.join("\n")], {
                type: "text/plain",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `solpulse-logs-${Date.now()}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <FileDown className="h-4 w-4 mr-1" />
            Export
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:text-white"
            onClick={onClearLogs}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>

          {/* tabs */}
          <div className="ml-auto flex gap-2 ">
            {["logs", "summary"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded text-xs border
                  ${
                    activeTab === tab
                      ? "bg-emerald-700 text-white border-emerald-700 "
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white"
                  }`}
              >
                {tab === "logs" ? (
            <span className="flex items-center gap-1">
              <NotebookText className="w-4 h-4" /> Logs
            </span>
          ) : (
            <span className="flex items-center gap-1">📊 Summary</span>
          )}
              </button>
            ))}
          </div>
        </div>

        {/* ---------- body ---------- */}
        <div
          className={`
            px-4 py-3 overflow-y-auto
            h-[calc(100%-144px)]             /* handle + hdr + toolbar */
            bg-black-1000/95                   /* glass */
            font-mono text-[13px] leading-relaxed
            ${glowTrigger ? "animate-flash-glow" : ""}
          `}
        >
          {activeTab === "logs" ? (
            visibleLogs.length ? (
              visibleLogs.map(renderLog)
            ) : (
              <div className="text-green-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Awaiting activity…
              </div>
            )
          ) : (
            renderSummary()
          )}

          {/* bottom spacer */}
          <div ref={bottomRef} className="pb-8" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
