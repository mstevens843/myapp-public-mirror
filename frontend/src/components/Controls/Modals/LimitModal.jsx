// LimitModal.jsx
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { createLimitOrder } from "@/utils/api";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { HelpCircle , X, Target } from "lucide-react";

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
const buildPreview = ({ side, targetPrice, amount }) => {
  if (!amount || !targetPrice) return null;
  const verb     = side === "buy" ? "Buy" : "Sell";
  const symbol   = side === "buy" ? "≤"  : "≥";
  const color    = side === "buy" ? "text-emerald-400" : "text-red-400";
  return (
    <>
      <span className={`font-semibold ${color}`}>{verb}</span>{" "}
      {symbol}{" "}
      <span className="text-purple-400 font-semibold">${Number(targetPrice)}</span>{" "}
      •{" "}
      <span className="text-yellow-300 font-semibold">${Number(amount)}</span>{" "}
      USDC
    </>
  );
};

/* ───────────────────────── component ──────────────────────── */
export default function LimitModal({ open, onClose, tokenMint }) {
  const [mint, setMint]               = useState(tokenMint || "");
  const [side, setSide]               = useState("buy");
  const [targetPrice, setTargetPrice] = useState("");
  const [amount, setAmount]           = useState("");
  const [force, setForce]             = useState(false);

  useEffect(() => {
    if (open) {
      setMint(tokenMint || "");
      setSide("buy");
      setTargetPrice("");
      setAmount("");
      setForce(false);
    }
  }, [open, tokenMint]);

  const handleSave = async () => {
    try {
      if (!mint.trim())                   return toast.error("Token mint required");
      if (!targetPrice || targetPrice <= 0) return toast.error("Target price required");
      if (!amount || amount <= 0)         return toast.error("Amount required");

      const res = await createLimitOrder({
        mint: mint.trim(),
        side,
        targetPrice: Number(targetPrice),
        amount: Number(amount),
        force,
      });

      if (res?.success === false) return toast.error(res.message || "Save failed");
      toast.success(`✅ Set limit for ${shortMint(mint)} at $${targetPrice} — view in Pending tab.`);
      onClose();
    } catch (e) {
      if (e?.needForce) { setForce(true); return toast.error(e.error); }
      toast.error(e.message || "Save failed");
    }
  };

  if (!open) return null;

  const preview = buildPreview({ side, targetPrice, amount });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-[380px] space-y-5 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-white shadow-xl">
<h3 className="flex items-center justify-center gap-2 text-lg font-bold text-emerald-400">
  <Target size={18} className="text-red-500" /> Set Limit Order
</h3>
              <div 
        className="absolute top-3 right-3 cursor-pointer text-zinc-400 hover:text-red-400 transition-colors"
        onClick={onClose}
      >
        ✕
      </div>
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
            <Tooltip text='Side: "Buy" executes when live price ≤ target. "Sell" executes when live price ≥ target.' />
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

          {/* price */}
          <label className="flex items-center">
            <input
              type="number"
              step="0.0001"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="Target Price ($)"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
            <Tooltip text="USD price that will trigger the order." />
          </label>

          {/* amount */}
          <label className="flex items-center">
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount (USDC)"
              className="flex-1 rounded bg-zinc-800 px-2 py-1"
            />
            <Tooltip text="How much USDC to trade when the price hits target." />
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
              Save Limit
            </button>
          </div>
        </div>

        {/* live preview */}
        {preview && <p className="mt-2 text-center text-xs text-zinc-400">{preview}</p>}
      </div>
    </div>
  );
}
