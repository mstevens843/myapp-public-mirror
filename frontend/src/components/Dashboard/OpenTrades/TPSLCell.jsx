// components/Dashboard/OpenTrades/TpSlCell.jsx
import React, { useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import TpSlModal from "./TpSlModal";

export default function TpSlCell({
  walletId,
  mint,
  walletLabel,
  strategy,
  rules = [],
  onSaved
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingSettings, setEditingSettings] = useState({});

  // compute total allocated
  const totalAllocated = rules.reduce((sum, rule) => {
    const max = Math.max(
      rule.tpPercent || 0,
      rule.slPercent || 0,
      rule.sellPct   || 0
    );
    return sum + max;
  }, 0);

  return (
    <>
      <div className="flex flex-col items-start gap-1 text-xs w-full">

        {rules.length > 0 ? (
          <>
            {rules.map((rule, idx) => {
              const alloc = Math.max(rule.tpPercent || 0, rule.slPercent || 0, rule.sellPct || 0);
              return (
                <div key={idx} className="flex items-center gap-2 w-full">
                  <span className="text-zinc-300">
                    •{" "}
                    {rule.tp && rule.tpPercent && (
                      <span className="text-green-300">
                        TP +{rule.tp}%
                      </span>
                    )}
                    {rule.tp && rule.tpPercent && rule.sl && rule.slPercent && " / "}
                    {rule.sl && rule.slPercent && (
                      <span className="text-rose-300">
                        SL -{rule.sl}%
                      </span>
                    )}
                    {" "}
                    <span className="text-blue-400">({alloc}% alloc)</span>
                  </span>
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
              );
            })}

            <div className="text-blue-400 text-xs font-semibold mt-1 w-full">
              Total: {totalAllocated}% allocated
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

        <button
          onClick={() => {
            setEditingSettings({});
            setShowModal(true);
          }}
          className="mt-1 text-emerald-400 hover:text-emerald-200 text-xs underline"
        >
          + Add TP/SL Rule
        </button>
      </div>

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
