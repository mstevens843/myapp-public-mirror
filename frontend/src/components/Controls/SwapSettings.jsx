/* ------------------------------------------------------------------
 * SwapSettingsPopover.jsx
 * ------------------------------------------------------------------
 * Props
 *  ─ current     – number ▸ the current slippage % to pre-fill
 *  ─ onApply(opts) – callback fired when user hits “Apply”
 *  ─ className   – optional extra classes for the trigger <Button>
 * ------------------------------------------------------------------
 */

import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Settings as Gear } from "lucide-react";

export default function SwapSettingsPopover({
  open,
  setOpen,
  current,
  onApply,
  alreadyHolding,  // ✅ ADD THIS
  className,
  title,
  
}) {
  /* ───────────── component state ───────────── */
  const [slippage, setSlippage]   = useState(current);
  const [priorityFee, setPriority] = useState("");
  const [enableTPSL, setEnable]    = useState(false);

  /* TP / SL inputs (shown only when toggle ON) */
  const [tp, setTp] = useState(""); // %
  const [sl, setSl] = useState(""); // %
  const [tpPercent, setTpPercent] = useState("");
const [slPercent, setSlPercent] = useState("");


  const sliderUpper = slippage > 10 ? Math.ceil(slippage * 1.2) : 10; // grow with value
  const MAX_SLIPPAGE = 100;   // ← Jupiter allows up to 100 % (10 000 bps)


  /* ──────────────── UI ─────────────────────── */
  return (
<Popover open={open ?? undefined} onOpenChange={setOpen ?? (() => {})}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          <Gear className="h-5 w-5 text-inherit group-hover:rotate-45 transition-transform" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
  sideOffset={8}
  className="relative z-50 w-72 rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl text-white"
>
  {/* ── header row ───────────────────────────── */}
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-base font-semibold">Swap Settings</h3>
    <button
      onClick={() => setOpen(false)}
      className="grid h-6 w-6 place-items-center rounded hover:bg-zinc-800"
      aria-label="Close"
    >
      <span className="text-lg leading-none text-zinc-400 hover:text-white">×</span>
    </button>
  </div>

        <div className="space-y-4">

        {/* Slippage */}
        <div>
          <label className="mb-1 block text-xs font-medium text-white">
            Max Slippage (%)
          </label>
          <div className="flex items-center gap-3">
          <Slider
            min={0.1}
            max={MAX_SLIPPAGE}        // ▼ no more 10 % ceiling
            step={0.1}
            value={[slippage]}
            onValueChange={(v) => setSlippage(v[0])}
            className="flex-1"
          />
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={slippage}
              onChange={(e) => setSlippage(parseFloat(e.target.value))}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white text-right"
            />
          </div>
        </div>

        {/* Priority Fee */}
        <div>
          <label className="mb-1 block text-xs font-medium text-white">
            Priority Fee (SOL)
          </label>
          <input
            type="number"
            step="0.0001"
            value={priorityFee}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="0.001"
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white"
          />
        </div>

        {/* Toggle TP/SL */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white">
            Set TP/SL (Optional)
          </span>
          <div className="flex items-center justify-between">
  <span className="text-xs font-medium text-white">
    Set TP/SL (Optional)
  </span>

  {alreadyHolding ? (
    <div
      title="You already hold this token+strategy. Manage TP/SL in Open Trades."
      className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 text-xs italic cursor-not-allowed"
    >
      Unavailable
    </div>
  ) : (
    <Switch checked={enableTPSL} onCheckedChange={setEnable} />
  )}
</div>
        </div>

        {/* TP/SL inputs */}
        {/* TP/SL inputs (grid layout with sell %) */}
{enableTPSL && !alreadyHolding && (
  <div className="grid grid-cols-2 gap-3 text-xs">
    <div className="flex flex-col items-center">
      <span className="mb-1">TP Trigger (%)</span>
      <input
        type="number"
        step="0.1"
        value={tp}
        onChange={(e) => setTp(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white text-center"
      />
    </div>
    <div className="flex flex-col items-center">
      <span className="mb-1">TP Sell Amount %</span>
      <input
        type="number"
        step="0.1"
        value={tpPercent}
        onChange={(e) => setTpPercent(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white text-center"
      />
    </div>
    <div className="flex flex-col items-center">
      <span className="mb-1">SL Trigger (%)</span>
      <input
        type="number"
        step="0.1"
        value={sl}
        onChange={(e) => setSl(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white text-center"
      />
    </div>
    <div className="flex flex-col items-center">
      <span className="mb-1">SL Sell Amount %</span>
      <input
        type="number"
        step="0.1"
        value={slPercent}
        onChange={(e) => setSlPercent(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white text-center"
      />
    </div>
  </div>
)}
{enableTPSL && alreadyHolding && (
  <div className="mt-2 text-center text-xs text-red-400">
    🚫 You already hold this token with this strategy. Manage TP/SL in Open Trades.
  </div>
)}
        </div>

        {/* Apply Button */}
        <Button
            variant="ghost"
          size="sm"
          className="mt-4 w-full rounded-md bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white"
          onClick={() => {
    onApply({
      slippage,
      priorityFee: priorityFee ? parseFloat(priorityFee) : null,
      enableTPSL,
      tp: tp ? parseFloat(tp) : null,
      tpPercent: tpPercent ? parseFloat(tpPercent) : null,
      sl: sl ? parseFloat(sl) : null,
      slPercent: slPercent ? parseFloat(slPercent) : null,
    });
    setOpen?.(false); // ✅ auto-close
  }}
>
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}
