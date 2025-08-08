/* ============================================================
 * ManageSchedulesModal.jsx – inline “glow” redesign 🟣🟢
 * v2.4 – status lifecycle support (pending → running → finished)
 * ------------------------------------------------------------
 * • Shows live ⏳ countdown when status === "pending" && <24 h
 * • Displays 🟢 Running / ✅ Finished / ⛔ Stopped states
 * • Edit allowed only while pending
 * • Delete/Cancel adapts to state
 * ========================================================== */

import { useEffect, useRef, useState } from "react";
import { cancelSchedule } from "@/utils/scheduler";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import ScheduleLaunchModal from "../../Strategy_Configs/ScheduleLaunchModal";
import { useSchedules } from "@/hooks/useSchedules";

/* Detect browser TZ (fallback → LA) */
const USER_TZ =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

/* truncate long mint addresses */
const truncate = (s, len = 4) =>
  s.length <= len * 2 + 3 ? s : `${s.slice(0, len)}…${s.slice(-len)}`;

export default function ManageSchedulesModal({ open, onClose }) {
  const { edit, schedules, refetch } = useSchedules();
  const [editing, setEditing] = useState(null);
  const fetchedRef = useRef(false);

  /* tick every second for countdowns */
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [open]);

  /* refresh list on open */
  useEffect(() => {
    if (open && !fetchedRef.current) {
      refetch();
      fetchedRef.current = true;
    }
    if (!open) fetchedRef.current = false;
  }, [open]);

  /* delete / cancel handler */
  const del = async (jobId) => {
    await cancelSchedule(jobId);
    toast.success("Schedule removed 🗑️");
    refetch();
  };

  const handleSaveSchedule = async ({
    jobId,
    launchISO,
    config,
    targetToken,
    name,
  }) => {
    await edit({ jobId, launchISO, config, targetToken, name });
    setEditing(null);
    toast.success("Schedule updated ✏️");
    refetch();
  };

  const prettyDate = (utcISO) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: USER_TZ,
      timeZoneName: "short",
    }).format(new Date(utcISO));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full bg-[#0a0a0a] text-white border border-[#333] p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            📋 Scheduled Strategies
          </DialogTitle>
        </DialogHeader>

        {schedules.length === 0 ? (
          <p className="text-[#777] text-sm mt-4">No jobs scheduled.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {schedules.map((j) => {
              const cfg      = j.config || {};
              const status   = j.status || "pending";
              const isLimit  = cfg.buyMode === "limit";
              const tpSet    = cfg.takeProfit != null;
              const slSet    = cfg.stopLoss  != null;

              /* spend display */
              let spendLabel = "—";
              if (isLimit) {
                const tiers   = cfg.limitConfigs ?? [];
                const totalUsd = tiers.reduce(
                  (sum, t) => sum + Number(t.amount || 0),
                  0
                );
                spendLabel = `$${totalUsd}`;
              } else {
                spendLabel = `${cfg.amountToSpend} SOL`;
              }

              /* countdown (only while pending) */
              let countdown = null;
              if (status === "pending") {
                const msLeft = new Date(j.launchISO) - now;
                if (msLeft > 0 && msLeft <= 86_400_000) {
                  const hrs  = Math.floor(msLeft / 3_600_000);
                  const mins = Math.floor((msLeft % 3_600_000) / 60_000);
                  const secs = Math.floor((msLeft % 60_000) / 1_000);
                  countdown  = `Launching in: ${hrs}h ${mins}m ${secs}s`;
                }
              }

              /* status label */
              const statusLabel = {
                pending  : countdown || "🕒 Queued",
                running  : "🟢 Running",
                completed: "✅ Finished",
                stopped  : "⛔ Stopped",
              }[status];

              /* action button visibility */
              const canEdit   = status === "pending";
              const btnTitle  =
                status === "pending" ? "Cancel" : "Delete";
              const btnClass  =
                status === "pending" ? "text-yellow-400" : "text-red-400";

              return (
                <motion.li
                  key={j.jobId ?? j.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border border-[#333] rounded-md p-3"
                >
                  <div className="flex justify-between items-start">
                    {/* meta */}
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[#ddd]">
                        {j.name ? j.name : `#${String(j.id).slice(0, 4)}`}
                      </p>

                      <p className="text-xs text-[#999]">
                        {prettyDate(j.launchISO)}
                      </p>

                      {statusLabel && (
                        <p className="text-xs text-emerald-400">{statusLabel}</p>
                      )}

                      {j.targetToken && (
                        <p className="text-xs text-[#aaa]">
                          🎯 {truncate(j.targetToken)}
                        </p>
                      )}

                      <p className="text-xs text-[#aaa]">
                        ⚙️{" "}
                        {isLimit
                          ? `Limit (${cfg.limitConfigs?.length || 0} tiers)`
                          : `Interval (${cfg.maxTrades}× buys, every ${
                              cfg.interval
                            } s)`}
                      </p>

                      <p className="text-xs text-[#aaa]">
                        💰 Spend: {spendLabel}
                      </p>

                      {(tpSet || slSet) && (
                        <p className="text-xs text-[#aaa]">
                          🎯 TP/SL: {tpSet ? cfg.takeProfit : "—"} /{" "}
                          {slSet ? cfg.stopLoss : "—"}
                        </p>
                      )}
                    </div>

                    {/* actions */}
                    <div className="flex gap-2">
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditing(j)}
                          title="Edit"
                        >
                          <Wrench size={14} />
                        </Button>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        className={btnClass}
                        onClick={() => del(j.jobId ?? j.id)}
                        title={btnTitle}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </DialogContent>

      {/* edit modal */}
      {editing && (
        <ScheduleLaunchModal
          open={!!editing}
          initial={editing}
          isEdit
          userTimezone={USER_TZ}
          onClose={() => setEditing(null)}
          onConfirm={handleSaveSchedule}
        />
      )}
    </Dialog>
  );
}
