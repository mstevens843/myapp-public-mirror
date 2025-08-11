import React, { useRef, useEffect } from "react";
import { useLogsStore } from "@/state/LogsStore";

const MiniConsole = ({
  show,
  isAutoscroll,
  setAutoscroll,
  setLogsOpen,
  logBotId,
  currentBotId,
  selectedMode,
  config,
}) => {
  const miniConsoleRef = useRef(null);
  const logs = useLogsStore((s) => s.logs);

  useEffect(() => {
    if (miniConsoleRef.current) {
      miniConsoleRef.current.scrollTop = miniConsoleRef.current.scrollHeight;
    }
  }, [logs]);

  if (!show) return null;

  return (
    <div
      ref={miniConsoleRef}
      className="
        relative max-h-[140px] min-h-[100px] w-full overflow-y-auto
        mt-0 mx-0 px-3 py-2
        font-mono text-xs leading-[1.35] space-y-[2px]
        bg-zinc-950/95 backdrop-blur-sm
        border border-zinc-700/70 rounded-lg
        shadow-[0_0_10px_#10b98111]
        scrollbar-thin animate-fade-in
      "
    >
      {/* 🔹 Top fade mask */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-zinc-950/95 via-zinc-950/80 to-transparent" />

      {/* 🔹 Slim status bar */}
      <div className="sticky right-0 top-0 flex justify-end items-center gap-2 h-4 px-2 text-[10px] text-zinc-400">
        🖥 Mini Console
        {isAutoscroll && <span className="animate-pulse text-emerald-400">LIVE</span>}
      </div>

      {/* 🔹 Logs */}
      {logs.length === 0 ? (
        <p className="pt-5 text-zinc-500 italic">Waiting for log messages…</p>
      ) : (
        logs.slice(-10).map((log, idx) => {
        const logText = typeof log === "string" ? log : log.text || "";

        let bar = "bg-zinc-600";
        if (logText.includes("[ERROR]")) bar = "bg-red-500";
        else if (logText.includes("[WARN]")) bar = "bg-yellow-400";
        else if (logText.includes("[INFO]")) bar = "bg-green-500";
        else if (logText.includes("[LOOP]")) bar = "bg-blue-500";

        return (
          <div key={idx} className="flex">
            <span className={`flex-shrink-0 w-[2px] mr-2 rounded-sm ${bar}`} />
            {/*
              Render log text directly instead of injecting HTML.  Using
              dangerouslySetInnerHTML here could lead to XSS if logs ever
              contain untrusted strings.  We treat all log entries as plain
              text and rely on <pre> with whitespace preservation to
              display newlines and spacing.  The text is never interpreted
              as HTML.
            */}
            <pre className="whitespace-pre-wrap text-zinc-300">
              {logText}
            </pre>
          </div>
        );
      })
      )}

      {/* 🔹 Footer controls */}
      <div className="pt-5 flex justify-end gap-2 text-[10px]">
        <button
          onClick={() => {
            const id = logBotId || currentBotId;
            if (id) {
              window.dispatchEvent(
                new CustomEvent("setLogsTarget", {
                  detail: { botId: id, strategy: selectedMode, config },
                })
              );
            }
            setLogsOpen(true);
          }}
          className="px-2 py-[1px] rounded border border-zinc-700 text-emerald-400 hover:text-white hover:bg-zinc-800 transition"
        >
          Open
        </button>
        <button
          onClick={() => useLogsStore.getState().clear()}
          className="px-2 py-[1px] rounded border border-zinc-700 text-rose-400 hover:text-white hover:bg-zinc-800 transition"
        >
          Clear
        </button>
        <button
          onClick={() => setAutoscroll((p) => !p)}
          className={`px-2 py-[1px] rounded border border-zinc-700 ${
            isAutoscroll ? "text-emerald-400" : "text-zinc-400"
          } hover:text-white hover:bg-zinc-800 transition`}
        >
          {isAutoscroll ? "Auto" : "⏸"}
        </button>
      </div>
    </div>
  );
};

export default MiniConsole;
