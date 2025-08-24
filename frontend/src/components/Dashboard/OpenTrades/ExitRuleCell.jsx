// components/Dashboard/OpenTrades/ExitRuleCell.jsx
// Exit Rules = TP/SL + Smart Exit (time | volume | liquidity)
// - Live countdown for Smart-time using entry timestamp + hold seconds
// - Inline Smart-time editor (PATCH extras)
// - Aug 23, 2025 — countdown + minPnL gate displayed inside the same pill

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { toast } from "sonner";
import TpSlModal from "./TpSlModal";
import { updateSmartExit, cancelSmartExit } from "@/utils/trades_positions";

export default function ExitRuleCell({
  tradeId,
  walletId,
  mint,
  walletLabel,
  strategy,
  rules = [],
  smartExit = {},
  entryTs,        // ms number OR ISO OR PG "YYYY-MM-DD HH:mm:ss.SSS"
  onSaved,
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingSettings, setEditingSettings] = useState({});
  const [editSmartOpen, setEditSmartOpen] = useState(false);
  const [editSmartMins, setEditSmartMins] = useState("");

  // Local mirror so UI can jump immediately on Save/Turn Off (optimistic)
  const [localSmartExit, setLocalSmartExit] = useState(smartExit || {});
  useEffect(() => setLocalSmartExit(smartExit || {}), [smartExit]);

  // Sum allocation per rule = max(tpPercent, slPercent)
  const totalAllocated = useMemo(
    () =>
      (rules || []).reduce((sum, rule) => {
        const tpPct = Number(rule?.tpPercent) || 0;
        const slPct = Number(rule?.slPercent) || 0;
        return sum + Math.max(tpPct, slPct);
      }, 0),
    [rules]
  );

  // ───────────────────────── Smart-exit label (base) ─────────────────────────
  const smartMode = localSmartExit?.mode ?? localSmartExit?.smartExitMode ?? "none";

  const smartLine =
    smartMode && smartMode !== "none"
      ? (function () {
          if (smartMode === "time") {
            const sec = Number(localSmartExit?.timeMaxHoldSec);
            if (Number.isFinite(sec) && sec > 0) {
              const mins = Math.floor(sec / 60);
              return `Smart-time: ${mins > 0 ? `${mins}m` : `${sec}s`}`;
            }
            if (localSmartExit.smartExitTimeMins != null) {
              return `Smart-time: ${localSmartExit.smartExitTimeMins}m`;
            }
          }
          if (smartMode === "volume" && localSmartExit.smartVolThreshold != null) {
            return `Smart-volume: ${localSmartExit.smartVolThreshold}`;
          }
          if (smartMode === "liquidity" && localSmartExit.smartLiqDropPct != null) {
            return `Smart-liquidity: ${localSmartExit.smartLiqDropPct}%`;
          }
          return `Smart-${smartMode}`;
        })()
      : null;

  // ───────────────────────── Live countdown (TIME smart-exit) ─────────────────────────
  // Parse entryTs (supports ms, ISO, and PG "YYYY-MM-DD HH:mm:ss.SSS")
  const startMs = useMemo(() => {
    if (entryTs == null) return null;
    if (typeof entryTs === "number") return Number.isFinite(entryTs) ? entryTs : null;
    const raw = String(entryTs).trim();

    // try native first
    let t = Date.parse(raw);
    if (Number.isFinite(t)) return t;

    // PG style => replace space with "T"
    const isoish = raw.includes(" ") ? raw.replace(" ", "T") : raw;
    t = Date.parse(isoish);
    if (Number.isFinite(t)) return t;

    // assume UTC if still failing
    t = Date.parse(isoish + "Z");
    return Number.isFinite(t) ? t : null;
  }, [entryTs]);

  // Prefer explicit seconds; else compute from minutes
  const holdSec = useMemo(() => {
    const sec = Number(localSmartExit?.timeMaxHoldSec);
    if (Number.isFinite(sec) && sec > 0) return Math.floor(sec);
    const mins = Number(localSmartExit?.smartExitTimeMins);
    if (Number.isFinite(mins) && mins > 0) return Math.floor(mins * 60);
    return null;
  }, [localSmartExit]);

  const [now, setNow] = useState(() => Date.now());
  const firedRefreshRef = useRef(false);

  // tick every second while in time-mode
  useEffect(() => {
    if (smartMode !== "time" || !startMs || !holdSec) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [smartMode, startMs, holdSec]);

  // Reset the "already refreshed" guard whenever parameters change
  useEffect(() => {
    firedRefreshRef.current = false;
  }, [startMs, holdSec, smartMode]);

  const expiryMs = useMemo(() => (startMs && holdSec ? startMs + holdSec * 1000 : null), [startMs, holdSec]);
  const remainingSec = useMemo(() => {
    if (!expiryMs) return null;
    const diff = Math.ceil((expiryMs - now) / 1000);
    return diff > 0 ? diff : 0;
  }, [expiryMs, now]);

  // After countdown reaches zero, trigger one refresh so the row disappears quickly
  useEffect(() => {
    if (remainingSec === 0 && smartMode === "time" && !firedRefreshRef.current) {
      firedRefreshRef.current = true;
      setTimeout(() => onSaved?.(), 900); // show 0:00 briefly, then refresh
    }
  }, [remainingSec, smartMode, onSaved]);

  const showCountdown = smartMode === "time" && startMs && holdSec;

  // min-PnL gate (support multiple key shapes)
  const gateNumber = useMemo(() => {
    const g =
      localSmartExit?.time?.minPnLBeforeTimeExitPct ??
      localSmartExit?.minPnLBeforeTimeExitPct ??
      localSmartExit?.timeMinPnLBeforeTimeExitPct;
    const n = Number(g);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [localSmartExit]);

  const hasRules = Array.isArray(rules) && rules.length > 0;

  // ───────────────────────── Smart-time inline edit handlers ─────────────────────────
  useEffect(() => {
    if (!editSmartOpen) return;
    const sec = Number(localSmartExit?.timeMaxHoldSec) || 0;
    setEditSmartMins(sec > 0 ? Math.floor(sec / 60) : "");
  }, [editSmartOpen, localSmartExit]);

  async function saveSmartTime() {
    if (!tradeId) {
      toast.error("tradeId missing for Smart Exit edit");
      return;
    }
    const mins = Number(editSmartMins);
    if (!Number.isFinite(mins) || mins <= 0) {
      toast.error("Enter a positive number of minutes");
      return;
    }
    const newSec = Math.floor(mins * 60);
    try {
      // Optimistically update UI so the countdown jumps immediately
      setLocalSmartExit((prev) => ({
        ...(prev || {}),
        mode: "time",
        smartExitMode: "time",
        timeMaxHoldSec: newSec,
        time: { ...(prev?.time || {}), maxHoldSec: newSec },
      }));
      await updateSmartExit(tradeId, { smartExitMode: "time", timeMaxHoldSec: newSec });
      toast.success("Smart-time updated");
      setEditSmartOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error(e.message || "Failed to update Smart Exit");
    }
  }

  async function cancelSmart() {
    if (!tradeId) {
      toast.error("tradeId missing for Smart Exit cancel");
      return;
    }
    try {
      setLocalSmartExit({ mode: "none" }); // instantly hide
      await cancelSmartExit(tradeId);
      toast.success("Smart Exit canceled");
      setEditSmartOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error(e.message || "Failed to cancel Smart Exit");
    }
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1 text-xs w-full px-2">
        {/* TP/SL rules */}
        {hasRules ? (
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

        {/* Smart Exit (single pill: mode + countdown + minPnL gate) */}
        {smartLine && (
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-[1px] rounded-full text-xs font-semibold border bg-sky-600/20 text-sky-200 border-sky-500">
              {smartLine}
              {showCountdown ? ` : ${fmtHMS(remainingSec)}` : ""}
              {gateNumber != null ? ` • ≥ +${gateNumber}% PnL` : ""}
            </span>

            {/* Inline editor trigger */}
            {tradeId && smartMode === "time" && (
              <button
                className="ml-1 inline-flex items-center gap-1 text-[10px] text-zinc-300 hover:text-white"
                onClick={() => setEditSmartOpen((v) => !v)}
                title="Edit Smart-time"
              >
                <FaPencilAlt className="w-3 h-3" /> Edit
              </button>
            )}
          </div>
        )}

        {/* Inline Smart-time editor */}
        {editSmartOpen && (
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <label className="opacity-80">Hold</label>
            <input
              type="number"
              min={1}
              className="w-16 rounded bg-zinc-800 px-1 py-0.5 text-center"
              value={editSmartMins}
              onChange={(e) => setEditSmartMins(e.target.value)}
            />
            <span className="opacity-80">mins</span>
            <button className="rounded bg-emerald-600 px-2 py-0.5 hover:bg-emerald-700" onClick={saveSmartTime}>
              Save
            </button>
            <button className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600" onClick={() => setEditSmartOpen(false)}>
              Cancel
            </button>
            <button className="rounded bg-red-600 px-2 py-0.5 hover:bg-red-700" onClick={cancelSmart} title="Turn off Smart Exit">
              Turn Off
            </button>
          </div>
        )}

        {/* Add/Edit TP/SL */}
        <button
          onClick={() => {
            setEditingSettings((rules && rules[0]) || {});
            setShowModal(true);
          }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-300 hover:text-white"
          title={rules?.length ? "Edit your TP/SL rule" : "Add a TP/SL rule"}
        >
          <FaPencilAlt className="w-3 h-3" /> {rules?.length ? "Edit TP/SL" : "Add TP/SL"}
        </button>
      </div>

      {/* TP/SL modal */}
      {showModal && (
        <TpSlModal
          open={showModal}
          onClose={() => setShowModal(false)}
          walletId={walletId}
          walletLabel={walletLabel}
          mint={mint}
          strategy={strategy}
          settings={editingSettings}
          totalAllocated={totalAllocated}
          onSaved={() => {
            setShowModal(false);
            onSaved?.();
          }}
        />
      )}
    </>
  );
}

// format H:MM:SS or M:SS
function fmtHMS(total) {
  const s = Math.max(0, Math.floor(total || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return (h > 0 ? `${h}:` : "") + `${mm}:${ss}`;
}
