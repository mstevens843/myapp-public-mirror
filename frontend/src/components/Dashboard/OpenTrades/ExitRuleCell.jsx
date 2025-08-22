// components/Dashboard/OpenTrades/ExitRuleCell.jsx
// Unified Exit Rules cell: TP/SL + Smart Exit (time | volume | liquidity)
// Aug 22, 2025 — Add live countdown for Smart-time using trade timestamp + hold seconds
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import TpSlModal from "./TpSlModal";

export default function ExitRuleCell({
  walletId,
  mint,
  walletLabel,
  strategy,
  rules = [],
  smartExit = {},
  entryTs,              // ⇐ new: trade timestamp (ms or ISO) to anchor countdown
  onSaved,
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingSettings, setEditingSettings] = useState({});

  // Sum the effective allocation per rule = max(tpPercent, slPercent)
  const totalAllocated = useMemo(
    () =>
      (rules || []).reduce((sum, rule) => {
        const tpPct = Number(rule?.tpPercent) || 0;
        const slPct = Number(rule?.slPercent) || 0;
        return sum + Math.max(tpPct, slPct);
      }, 0),
    [rules]
  );

  // Smart-exit mode + label (static)
  const smartMode = smartExit?.mode ?? smartExit?.smartExitMode ?? "none";
  const smartLine =
    smartMode && smartMode !== "none"
      ? (function () {
          if (smartMode === "time") {
            // Prefer explicit seconds if provided; fall back to minutes for the label
            const sec = Number(smartExit?.timeMaxHoldSec);
            if (Number.isFinite(sec) && sec > 0) {
              const mins = Math.floor(sec / 60);
              return `Smart-time: ${mins > 0 ? `${mins}m` : `${sec}s`}`;
            }
            if (smartExit.smartExitTimeMins != null) {
              return `Smart-time: ${smartExit.smartExitTimeMins}m`;
            }
          }
          if (smartMode === "volume" && smartExit.smartVolThreshold != null) {
            return `Smart-volume: ${smartExit.smartVolThreshold}`;
          }
          if (smartMode === "liquidity" && smartExit.smartLiqDropPct != null) {
            return `Smart-liquidity: ${smartExit.smartLiqDropPct}%`;
          }
          // fallback – show mode if no detail present
          return `Smart-${smartMode}`;
        })()
      : null;

  // ───────────────────────── Live countdown (TIME smart-exit) ─────────────────────────
  // We derive expiry = entryTs + holdSec (in seconds). Backend handles the actual exit;
  // this is a *visualization* so the user sees the remaining time.
  const startMs = useMemo(() => {
    if (!entryTs) return null;
    const t = typeof entryTs === "number" ? entryTs : Date.parse(entryTs);
    return Number.isFinite(t) ? t : null;
  }, [entryTs]);

  const holdSec = useMemo(() => {
    // Prefer explicit seconds if present on the object; else compute from minutes
    const sec = Number(smartExit?.timeMaxHoldSec);
    if (Number.isFinite(sec) && sec > 0) return Math.floor(sec);
    const mins = Number(smartExit?.smartExitTimeMins);
    if (Number.isFinite(mins) && mins > 0) return Math.floor(mins * 60);
    return null;
  }, [smartExit]);

  const [now, setNow] = useState(() => Date.now());
  const firedRefreshRef = useRef(false);

  useEffect(() => {
    if (smartMode !== "time" || !startMs || !holdSec) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [smartMode, startMs, holdSec]);

  const expiryMs = useMemo(() => {
    if (!startMs || !holdSec) return null;
    return startMs + holdSec * 1000;
  }, [startMs, holdSec]);

  const remainingSec = useMemo(() => {
    if (!expiryMs) return null;
    const diff = Math.ceil((expiryMs - now) / 1000);
    return diff > 0 ? diff : 0;
  }, [expiryMs, now]);

  // When countdown hits zero, ask parent to refresh once (so the row disappears quickly)
  useEffect(() => {
    if (remainingSec === 0 && !firedRefreshRef.current) {
      firedRefreshRef.current = true;
      // slight delay to let backend perform the sell & API reflect it
      setTimeout(() => onSaved?.(), 1200);
    }
  }, [remainingSec, onSaved]);

  function fmtHMS(totalSec) {
    const s = Math.max(0, Math.floor(totalSec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    return `${m}:${String(ss).padStart(2, "0")}`;
  }

  const showCountdown = smartMode === "time" && startMs && holdSec;

  return (
    <>
      <div className="flex flex-col items-start gap-1 text-xs w-full">
        {/* TP/SL rules (each line is single-line; stack vertically) */}
        {rules && rules.length > 0 ? (
          <>
            {rules.map((rule, idx) => {
              const tp = rule?.tp;
              const sl = rule?.sl;
              const tpPct = Number(rule?.tpPercent) || 0;
              const slPct = Number(rule?.slPercent) || 0;

              const hasTpSell = tp != null && tpPct > 0;
              const hasSlSell = sl != null && slPct > 0;

              return (
                <div key={idx} className="w-full">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex flex-col gap-0.5">
                      {hasTpSell && (
                        <div className="text-zinc-200 whitespace-nowrap">
                          Sell <span className="font-semibold text-emerald-300">{tpPct}%</span>{" "}
                          at <span className="font-semibold">+{tp}% TP</span>
                        </div>
                      )}
                      {hasSlSell && (
                        <div className="text-zinc-200 whitespace-nowrap">
                          Sell <span className="font-semibold text-rose-300">{slPct}%</span>{" "}
                          at <span className="font-semibold">-{sl}% SL</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="text-zinc-400">No TP/SL rules</div>
        )}

        {/* Smart Exit summary + countdown (if time-mode) */}
        {smartLine && (
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-[1px] rounded-full text-xs font-semibold border bg-sky-600/20 text-sky-200 border-sky-500">
              {smartLine}
            </span>
            {showCountdown && (
              <span
                className={
                  "font-mono text-sm px-2 py-[1px] rounded border " +
                  (remainingSec <= 20
                    ? "border-rose-500 text-rose-300 bg-rose-600/20 animate-pulse"
                    : "border-emerald-500 text-emerald-300 bg-emerald-600/20")
                }
                title="Time left until Smart-time exit"
              >
                ⏳ {fmtHMS(remainingSec)}
              </span>
            )}
          </div>
        )}

        {/* Edit button */}
        <button
          onClick={() => {
            setEditingSettings({ rules, smartExit });
            setShowModal(true);
          }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-300 hover:text-white"
        >
          <FaPencilAlt className="w-3 h-3" /> Edit Exit Rules
        </button>
      </div>

      {/* Modal (unchanged behavior) */}
      {showModal && (
        <TpSlModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          walletId={walletId}
          walletLabel={walletLabel}
          mint={mint}
          strategy={strategy}
          initialSettings={editingSettings}
          onSaved={() => {
            setShowModal(false);
            onSaved?.();
          }}
        />
      )}
    </>
  );
}
