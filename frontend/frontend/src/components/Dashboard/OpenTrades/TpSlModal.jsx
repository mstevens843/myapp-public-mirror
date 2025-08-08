import React, { useState, useEffect } from "react";
import { updateTpSl, deleteTpSlSetting } from "@/utils/api";
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
  totalAllocated = 0,   // ADD THIS
}){
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [tpPercent, setTpPercent] = useState("");
  const [slPercent, setSlPercent] = useState("");
  const [sellPct, setSellPct] = useState("");

  useEffect(() => {
    if (open) {
      setTp(settings.tp ?? "");
      setSl(settings.sl ?? "");
      setTpPercent(settings.tpPercent ?? "");
      setSlPercent(settings.slPercent ?? "");
      setSellPct(settings.sellPct ?? "");
    }
  }, [open, settings]);

const handleSave = async () => {
  const toNum = (val) => val !== "" && !isNaN(val) ? Number(val) : 0;

  const tpVal = toNum(tp);
  const slVal = toNum(sl);
  const tpPct = toNum(tpPercent);
  const slPct = toNum(slPercent);

  const newAlloc = Math.max(tpPct, slPct);

if ((tpVal && !tpPct) || (slVal && !slPct)) {
  toast("Set both trigger and sell % for TP/SL.", { type: "error" });
  return;
}

  // ✅ use actual prop not settings
if (newAlloc + totalAllocated > 100) {
  toast.error(`⚠️ This rule would exceed 100% total allocation.`);
  return;
}

  try {
    await updateTpSl(mint, {
      walletId,
      tp: tpVal || undefined,
      tpPercent: tpPct || undefined,
      sl: slVal || undefined,
      slPercent: slPct || undefined,
      sellPct: tpPct + slPct,
      userId,
      walletLabel,
      strategy,
    });
  toast("✅ TP/SL saved", { type: "success" });
  onSaved?.();
  onClose();
} catch (e) {
  if (e.message.includes("exceed")) {
    toast("⚠️ TP/SL total exceeds 100% allocation.", { type: "error" });
  } else {
    toast(e.message, { type: "error" });
  }
}
};


const handleClear = async () => {
  try {
    await deleteTpSlSetting(settings.id);  // just needs ID now
    toast.success("❌ TP/SL rule cleared");
    onSaved?.();
    onClose();
  } catch (e) {
    toast.error(e.message);
  }
};

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center">
      <div className="bg-zinc-900 rounded-2xl p-6 w-[360px] text-white space-y-3 border border-zinc-700 shadow-xl relative">
        <div className="text-lg font-bold text-center text-green-400">Set TP / SL</div>

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
          {/* <div className="flex flex-col items-center col-span-2">
            <span className="mb-1">Sell Allocation (% of balance)</span>
            <input
              className="w-24 rounded bg-zinc-800 px-1 py-0.5 text-center"
              type="number"
              value={sellPct}
              onChange={(e) => setSellPct(e.target.value)}
            />
          </div> */}
        </div>

        <div className="flex justify-between pt-2">
          <button
            className="rounded bg-red-600 px-3 py-1 text-sm hover:bg-red-700"
            onClick={handleClear}
          >
            Clear / Delete Rule
          </button>
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
