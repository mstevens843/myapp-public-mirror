// components/Dashboard/OpenTrades/ExitRuleCell.jsx
// Unified Exit Rules cell: TP/SL + Smart Exit (time | volume | liquidity)
import React, { useMemo, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import TpSlModal from "./TpSlModal";

export default function ExitRuleCell({
  walletId,
  mint,
  walletLabel,
  strategy,
  rules = [],
  smartExit = {},
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

  // Smart-exit line
  const smartMode = smartExit?.mode ?? smartExit?.smartExitMode ?? "none";
  const smartLine =
    smartMode && smartMode !== "none"
      ? (function () {
          if (smartMode === "time" && smartExit.smartExitTimeMins != null) {
            return `Smart-time: ${smartExit.smartExitTimeMins}m`;
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
                          Sell{" "}
                          <span className="font-semibold text-emerald-300">{tpPct}%</span>{" "}
                          at{" "}
                          <span className="font-semibold text-emerald-300">
                            +{Number(tp)}% TP
                          </span>
                        </div>
                      )}
                      {hasSlSell && (
                        <div className="text-zinc-200 whitespace-nowrap">
                          Sell{" "}
                          <span className="font-semibold text-rose-300">{slPct}%</span>{" "}
                          at{" "}
                          <span className="font-semibold text-rose-300">
                            -{Number(sl)}% SL
                          </span>
                        </div>
                      )}
                      {!hasTpSell && !hasSlSell && (
                        <div className="text-zinc-400">No TP/SL sell set</div>
                      )}
                    </div>

                    {/* One edit pencil per rule (opens TP/SL modal) */}
                    <button
                      onClick={() => {
                        setEditingSettings(rule);
                        setShowModal(true);
                      }}
                      title="Edit TP/SL"
                      className="text-white hover:text-emerald-400 hover:scale-110 transition"
                    >
                      <FaPencilAlt size={12} />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="text-blue-400 text-xs font-semibold mt-1 w-full">
              Total: {Math.min(totalAllocated, 100)}% allocated
            </div>
            <div className="w-full h-1 bg-zinc-700 rounded mt-1">
              <div
                className="h-1 bg-blue-500 rounded transition-all"
                style={{ width: `${Math.min(totalAllocated, 100)}%` }}
              />
            </div>
          </>
        ) : (
          <div className="text-zinc-400">No TP/SL rules</div>
        )}

        {/* Smart-exit (shown beneath TP/SL if present) */}
        {smartLine && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[10px] font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500">
            {smartLine}
          </div>
        )}

        {/* Unified CTA label */}
        <button
          onClick={() => {
            setEditingSettings({});
            setShowModal(true); // Currently edits TP/SL; Smart-exit editing can be added later here
          }}
          className="mt-1 text-emerald-400 hover:text-emerald-200 text-xs underline"
        >
          + Add Exit Rule
        </button>
      </div>

      {/* Existing TP/SL modal for editing/adding threshold rules */}
      <TpSlModal
        open={showModal}
        onClose={() => setShowModal(false)}
        mint={mint}
        strategy={strategy}
        settings={editingSettings}
        onSaved={onSaved}
        userId="web"
        walletId={walletId}
        walletLabel={walletLabel}
        totalAllocated={totalAllocated}
      />
    </>
  );
}
