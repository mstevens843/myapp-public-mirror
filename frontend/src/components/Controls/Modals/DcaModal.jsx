// DcaModal.jsx
import React, { useState, useEffect } from "react";
import { toast } from "sonner"; 
import { createDcaOrder } from "@/utils/api";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { HelpCircle,  Recycle } from "lucide-react";

/* ───────────────────────── helpers ───────────────────────── */

function Tooltip({ text }) {
  return (
    <div className="relative group flex items-center">
      <HelpCircle
        size={13}
        className="ml-1 text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div
        className="absolute left-5 top-[-4px] z-20 hidden group-hover:block
                   bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600
                   max-w-[200px] w-max shadow-lg
                   whitespace-pre-line break-words overflow-hidden"
      >
        {text}
      </div>
    </div>
  );
}
const ForceToggle = ({ value, onChange }) => (
  <div className="flex items-center gap-1">
    <Switch
      checked={value}
      onCheckedChange={onChange}
      className="h-4 w-7"
      aria-label="Force queue"
    />
    <Tooltip text="Force‑queue lets you save the order even if you don’t yet have the token or funds." />
  </div>
);

/* live preview */
const buildPreview = ({
  side, amount, unit, numBuys, freq, stopAbove, stopBelow,
}) => {
  if (!amount || !numBuys || !freq) return null;
  const chunk = (Number(amount) / Number(numBuys)).toFixed(2);
  const verb  = side === "buy" ? "Buy" : "Sell";
  const color = side === "buy" ? "text-emerald-400" : "text-red-400";
  const hi    = stopAbove ? ` • stop ≥ $${stopAbove}` : "";
  const lo    = stopBelow ? ` • stop ≤ $${stopBelow}` : "";
  return (
    <>
      <span className={`${color} font-semibold`}>{verb}</span>{" "}
      <span className="text-cyan-300 font-semibold">{chunk} {unit.toUpperCase()}</span>{" "}
      every{" "}
      <span className="text-purple-400 font-semibold">
        {freq === "1" ? "hour" : `${freq} h`}
      </span>{" "}
      •{" "}
      <span className="text-yellow-300 font-semibold">{numBuys}</span>{" "}
      rounds{hi}{lo}
    </>
  );
};

/* ───────────────────────── component ──────────────────────── */
export default function DcaModal({ open, onClose, tokenMint }) {
  const [mint, setMint]         = useState("");
  const [side, setSide]         = useState("buy");
  const [amount, setAmount]     = useState("");
  const [unit, setUnit]         = useState("usdc");
  const [numBuys, setNumBuys]   = useState("");
  const [freq, setFreq]         = useState("");
  const [stopAbove, setStopAbove] = useState("");
  const [stopBelow, setStopBelow] = useState("");
  const [force, setForce]       = useState(false);

useEffect(() => {
  if (open) {
    setMint(tokenMint || "");
    setSide("buy");
    setAmount("");
    setUnit("usdc");
    setNumBuys("");
    setFreq("");
    setStopAbove("");
    setStopBelow("");
    setForce(false);
  }
}, [open, tokenMint]);
  const handleSave = async () => {
    try {
      if (!mint.trim())                     return toast.error("Token mint required");
      if (!amount || amount <= 0)           return toast.error("Amount required");
      if (!numBuys || numBuys <= 0)         return toast.error("# Buys required");
      if (!freq || freq <= 0)               return toast.error("Frequency required");

      const res = await createDcaOrder({
        mint: mint.trim(),
        side,
        amount: Number(amount),
        unit,
        numBuys: Number(numBuys),
        freqHours: Number(freq),
        stopAbove: stopAbove ? Number(stopAbove) : null,
        stopBelow: stopBelow ? Number(stopBelow) : null,
        force,
      });

      if (res?.success === false) return toast.error(res.message || "Save failed");
      toast.success("✅ DCA order queued");
      if (res.warn) toast(res.warn, { icon: "⚠️" });
      onClose();
    } catch (e) {
      if (e?.needForce) { setForce(true); return toast.error(e.error); }
      toast.error(e.message || "Save failed");
    }
  };

  if (!open) return null;

  const preview = buildPreview({ side, amount, unit, numBuys, freq, stopAbove, stopBelow });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-[400px] space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-white shadow-xl">
        <div 
  className="absolute top-3 right-3 cursor-pointer text-zinc-400 hover:text-red-400 transition-colors"
  onClick={onClose}
>
  ✕
</div>
<h3 className="flex items-center justify-center gap-2 text-lg font-bold text-emerald-400">
   <Recycle size={18} className="text-red-500" />Set DCA Order
</h3>
        {/* form */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* side */}
          <label className="col-span-2 flex items-center">
            <select
              value={side}
              onChange={e => setSide(e.target.value)}
              className="rounded bg-zinc-800 px-2 py-1"
            >
              <option value="buy">Buy ⬇</option>
              <option value="sell">Sell ⬆</option>
            </select>
            <Tooltip text='Side: "Buy" DCA accumulates token; "Sell" distributes holdings over time.' />
          </label>

          {/* mint */}
          <label className="col-span-2 flex items-center">
            <input
              value={mint}
              onChange={e => setMint(e.target.value)}
              placeholder="Token Mint"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
            <Tooltip text="Token mint address (base58) of the SPL token." />
          </label>

          {/* amount */}
          <label className="flex items-center">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
            <Tooltip text="Total budget to split across all buys/sells." />
          </label>

          {/* unit */}
          <label className="flex items-center">
            <select
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="rounded bg-zinc-800 px-2 py-1"
            >
              <option value="usdc">USDC</option>
              <option value="sol">SOL</option>
            </select>
            <Tooltip text="Currency unit. Only USDC and SOL supported." />
          </label>

          {/* numBuys */}
          <label className="flex items-center">
            <input
              type="number"
              min="1"
              value={numBuys}
              onChange={e => setNumBuys(e.target.value)}
              placeholder="# Buys"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
            <Tooltip text="Number of chunks to split the order into." />
          </label>

          {/* freq */}
          <label className="flex items-center">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={freq}
              onChange={e => setFreq(e.target.value)}
              placeholder="Freq (hrs)"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
           <Tooltip text="Hours between each buy/sell. Use decimals for minutes (0.5 = 30 min)." />
          </label>

          {/* stops */}
          <label className="flex items-center">
            <input
              type="number"
              step="0.0001"
              value={stopAbove}
              onChange={e => setStopAbove(e.target.value)}
              placeholder="Stop ≥ $"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
           <Tooltip text="Optional: skip if price rises above this level." />
          </label>

          <label className="flex items-center">
            <input
              type="number"
              step="0.0001"
              value={stopBelow}
              onChange={e => setStopBelow(e.target.value)}
              placeholder="Stop ≤ $"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
          <Tooltip text="Optional: skip if price falls below this level." />
          </label>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between pt-2">
          <ForceToggle value={force} onChange={setForce} />

          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs text-zinc-400 hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-700"
            >
              Save DCA
            </button>
          </div>
        </div>

        {/* live preview */}
        {preview && <p className="mt-2 text-center text-xs text-zinc-400">{preview}</p>}
      </div>
    </div>
  );
}
