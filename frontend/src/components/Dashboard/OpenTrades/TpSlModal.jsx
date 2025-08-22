// components/Dashboard/OpenTrades/TpSlModal.jsx
import React, { useState, useEffect } from "react";
import { updateTpSl, updateTpSlById, deleteTpSlSetting } from "@/utils/api";
import { toast } from "sonner";

export default function TpSlModal({
  open,
  onClose,
  mint,
  strategy,
  settings = {},
  walletId,
  onSaved,
  userId = "web",
  walletLabel = "default",
  totalAllocated = 0,
}) {
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [tpPercent, setTpPercent] = useState("");
  const [slPercent, setSlPercent] = useState("");

  useEffect(() => {
    if (open) {
      setTp(settings.tp ?? "");
      setSl(settings.sl ?? "");
      setTpPercent(settings.tpPercent ?? "");
      setSlPercent(settings.slPercent ?? "");
    }
  }, [open, settings]);

  const handleSave = async () => {
    const toNum = (val) => (val !== "" && !isNaN(val) ? Number(val) : 0);

    const tpVal = toNum(tp);
    const slVal = toNum(sl);
    const tpPct = toNum(tpPercent);
    const slPct = toNum(slPercent);

    // Require pair (trigger + percent) for each side used
    if ((tpVal && !tpPct) || (slVal && !slPct)) {
      toast.error("Set both trigger and sell % for TP/SL.");
      return;
    }

    const newAlloc = Math.max(tpPct, slPct);

    // When editing, exclude this rule’s current allocation from the total
    const currentRuleAlloc = Math.max(
      settings.tpPercent || 0,
      settings.slPercent || 0
    );
    const totalExcludingThis = Math.max(0, totalAllocated - currentRuleAlloc);

    if (newAlloc + totalExcludingThis > 100) {
      toast.error("⚠️ This rule would exceed 100% total allocation.");
      return;
    }

    try {
      if (settings?.id) {
        // EDIT: update existing rule in place
        await updateTpSlById(settings.id, {
          tp: tpVal || undefined,
          sl: slVal || undefined,
          tpPercent: tpPct || undefined,
          slPercent: slPct || undefined,
          strategy,
        });
      } else {
        // CREATE: keep existing flow
        await updateTpSl(mint, {
          walletId,
          tp: tpVal || undefined,
          tpPercent: tpPct || undefined,
          sl: slVal || undefined,
          slPercent: slPct || undefined,
          userId,
          walletLabel,
          strategy,
        });
      }

      toast.success("TP/SL saved");
      onSaved?.();
      onClose();
    } catch (e) {
      if (String(e.message || "").toLowerCase().includes("exceed")) {
        toast.error("⚠️ TP/SL total exceeds 100% allocation.");
      } else {
        toast.error(e.message || "Failed to save TP/SL");
      }
    }
  };

  const handleClear = async () => {
    try {
      await deleteTpSlSetting(settings.id);
      toast.success("❌ TP/SL rule cleared");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!open) return null;

  const isEditing = !!settings?.id;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center">
      <div className="bg-zinc-900 rounded-2xl p-6 w-[360px] text-white space-y-3 border border-zinc-700 shadow-xl relative">
        <div className="text-lg font-bold text-center text-green-400">
          {isEditing ? "Edit TP / SL" : "Set TP / SL"}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col items-center">
            <span className="mb-1">TP Trigger (price % gain)</span>
            <input
              className="w-24 rounded bg-zinc-800 px-1 py-0.5 text-center"
              type="number"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="mb-1">Sell Token Amount (%)</span>
            <input
              className="w-24 rounded bg-zinc-800 px-1 py-0.5 text-center"
              type="number"
              value={tpPercent}
              onChange={(e) => setTpPercent(e.target.value)}
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="mb-1">SL Trigger (price % loss)</span>
            <input
              className="w-24 rounded bg-zinc-800 px-1 py-0.5 text-center"
              type="number"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="mb-1">Sell Token Amount (%)</span>
            <input
              className="w-24 rounded bg-zinc-800 px-1 py-0.5 text-center"
              type="number"
              value={slPercent}
              onChange={(e) => setSlPercent(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-between pt-2">
          {isEditing ? (
            <button
              className="rounded bg-red-600 px-3 py-1 text-sm hover:bg-red-700"
              onClick={handleClear}
            >
              Delete Rule
            </button>
          ) : (
            <span />
          )}

          <button
            className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-700"
            onClick={handleSave}
          >
            Save Rule
          </button>
        </div>

        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-zinc-400 hover:text-white text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
