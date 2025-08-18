// LimitModal.jsx
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { createLimitOrder } from "@/utils/api";
import { Switch } from "@/components/ui/switch";
import { HelpCircle, X, Target } from "lucide-react";

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

/** Local, zero-dep shortener so the toast never explodes again */
function shortMint(m) {
  if (!m || typeof m !== "string") return "";
  const s = m.trim();
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

const ForceToggle = ({ value, onChange }) => (
  <div className="flex items-center gap-1">
    <Switch
      checked={value}
      onCheckedChange={onChange}
      className="h-4 w-7"
      aria-label="Force queue"
    />
    <Tooltip text="Force-queue lets you save the order even if you don’t yet have the token or funds." />
  </div>
);

/* live preview */
const buildPreview = ({ side, targetPrice, amount }) => {
  const tp = Number(targetPrice);
  const amt = Number(amount);
  if (!amt || !tp) return null;
  const verb  = side === "buy" ? "Buy" : "Sell";
  const symbol = side === "buy" ? "≤" : "≥";
  const color = side === "buy" ? "text-emerald-400" : "text-red-400";
  return (
    <>
      <span className={`font-semibold ${color}`}>{verb}</span>{" "}
      {symbol}{" "}
      <span className="text-purple-400 font-semibold">${tp}</span>{" "}
      •{" "}
      <span className="text-yellow-300 font-semibold">${amt}</span>{" "}
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
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (open) {
      setMint(tokenMint || "");
      setSide("buy");
      setTargetPrice("");
      setAmount("");
      setForce(false);
      setSaving(false);
    }
  }, [open, tokenMint]);

  const handleSave = async () => {
    const tp  = Number(targetPrice);
    const amt = Number(amount);

    if (!mint.trim())                 return toast.error("Token mint required");
    if (!tp || tp <= 0)               return toast.error("Target price required");
    if (!amt || amt <= 0)             return toast.error("Amount required");

    setSaving(true);
    try {
      const res = await createLimitOrder({
        mint: mint.trim(),
        side,
        targetPrice: tp,
        amount: amt,
        force,
      });

      if (res?.success === false || res?.error) {
        // Backend-style error surfaces here
        const msg = res?.message || res?.error || "Save failed";
        // If backend hints to force, flip it for convenience
        if (res?.needForce) setForce(true);
        setSaving(false);
        return toast.error(msg);
      }

      toast.success(`✅ Set limit for ${shortMint(mint)} at $${tp} — view in Pending tab.`);
      onClose?.();
    } catch (e) {
      // Preserve special needForce hint if present
      if (e?.needForce) {
        setForce(true);
        toast.error(e.error || "Order needs Force-queue to proceed.");
      } else {
        toast.error(e?.message || "Save failed");
      }
      setSaving(false);
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

        <button
          type="button"
          className="absolute top-3 right-3 text-zinc-400 hover:text-red-400 transition-colors"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>

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
              disabled={saving}
              className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Limit"}
            </button>
          </div>
        </div>

        {/* live preview */}
        {preview && <p className="mt-2 text-center text-xs text-zinc-400">{preview}</p>}
      </div>
    </div>
  );
}
