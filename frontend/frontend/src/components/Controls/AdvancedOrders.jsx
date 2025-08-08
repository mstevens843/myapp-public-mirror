import React, { useState } from "react";
import { toast } from "sonner"; 
import { createLimitOrder, createDcaOrder } from "@/utils/api";
import { HelpCircle } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

function ForceToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <Switch
        checked={value}
        onCheckedChange={onChange}
        className="h-4 w-7"
        aria-label="Force queue"
      />
      <Popover>
        <PopoverTrigger asChild>
          <span className="text-xs text-zinc-400 cursor-help">force</span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed"
        >
          Force-queue allows saving the order even if you don’t have the token or funds yet.
          Useful for prepping trades ahead of time or while waiting on liquidity.
        </PopoverContent>
      </Popover>
    </div>
  );
}


export default function AdvancedOrders({ disabled }) {
  if (disabled) return null;

  /* ─────────────────────────────  LIMIT  ───────────────────────────── */
  const [limitMint,   setLimitMint]   = useState("");
  const [limitSide,   setLimitSide]   = useState("buy");
  const [limitPrice,  setLimitPrice]  = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [limitForce,  setLimitForce]  = useState(false);          // NEW


  const handleLimitSave = async () => {
    try {
      const res = await createLimitOrder({
        mint:   limitMint.trim(),
        side:   limitSide,
        amount: Number(limitAmount),
        targetPrice: Number(limitPrice),
        force : limitForce,
      });
  
      if (res?.success === false) {
        toast.error(res.message || "❌ Failed to save limit order");
        return;
      }
  
      toast.success("✅ Limit order queued");
      setLimitMint(""); 
      setLimitPrice(""); 
      setLimitAmount("");
      setLimitForce(false);
  
    } catch (e) {
      if (e?.needForce) {
        toast.error(e.error);
        setLimitForce(true);
        return;
      }
  
      toast.error(e.message || "Failed to save limit order");
    }
  };

    /* live preview sentence (LIMIT) */
    const limitPreview = () => {
      if (!limitMint || !limitAmount || !limitPrice) return null;
  
      const verb   = limitSide === "buy" ? "Buy" : "Sell";
      const symbol = limitSide === "buy" ? "≤"  : "≥";
      const sign   = limitSide === "buy" ? "+"  : "−";
  
      return `${sign} ${verb} ${symbol} $${Number(limitPrice)} • $${Number(
        limitAmount
      )} USDC`;
    };
  

  /* ───────────────────────────────  DCA  ───────────────────────────── */
  const [dcaMint,     setDcaMint]     = useState("");
  const [dcaSide,     setDcaSide]     = useState("buy");   // NEW
  const [dcaAmount,   setDcaAmount]   = useState("");
  const [dcaUnit,     setDcaUnit]     = useState("usdc");
  const [dcaBuys,     setDcaBuys]     = useState("");
  const [dcaFreqHrs,  setDcaFreqHrs]  = useState("");
  const [dcaStopHigh, setDcaStopHigh] = useState("");
  const [dcaStopLow,  setDcaStopLow]  = useState("");
  const [dcaForce,    setDcaForce]    = useState(false);          // NEW


  const handleDcaSave = async () => {
    try {
      const res = await createDcaOrder({  
        mint:       dcaMint.trim(),
        side:       dcaSide,
        amount:     Number(dcaAmount),
        unit:       dcaUnit,
        numBuys:    Number(dcaBuys),
        freqHours:  Number(dcaFreqHrs),
        stopAbove:  dcaStopHigh === "" ? null : Number(dcaStopHigh),
        stopBelow:  dcaStopLow  === "" ? null : Number(dcaStopLow),
        force:      dcaForce,
      });
  
      if (res?.success === false) {
        toast.error(res.message || "❌ Failed to save DCA order");
        return;
      }
  
      toast.success("✅ DCA order queued");
  
      if (res.warn) {
        toast(res.warn, { icon: "⚠️" });
      }
  
      setDcaMint("");
      setDcaAmount("");
      setDcaBuys("");
      setDcaFreqHrs("");
      setDcaStopHigh("");
      setDcaStopLow("");
      setDcaForce(false);
      
    } catch (e) {
      if (e?.needForce) {
        toast.error(e.error);
        setDcaForce(true);
        return;
      }
  
      toast.error(e.message || "Failed to save DCA order");
    }
  }

  /* ────────────────────────────────  UI  ───────────────────────────── */
  const [open, setOpen] = useState(false);

  const limitHelp = `Limit orders let you buy or sell a token when its price hits a target.
  
  USDC-based limit orders only

• Side: "Buy" means you want to buy once price drops to target.
• Target $: The price you're waiting for.
• Amount: How much USDC you want to trade.

Format:
[buy|sell] [TOKEN_MINT] [AMOUNT USDC] [TARGET_PRICE USDC]

Example:
buy  7GCihg… 50  0.65 → Buy $50 when price hits $0.65
sell 7GCihg… 200 1.20 → Sell $200 when price hits $1.20`;

const dcaHelp = `DCA (Dollar-Cost Averaging) spreads your trade into smaller chunks over time.
• Amount: Total budget to split.
• # Buys: How many times to repeat.
• Freq: Time between buys, in hours. Use decimals for minutes:
  0.5 = 30 min, 0.25 = 15 min, 1.5 = 90 min
  • Stops: Optional price limits for when to skip.

Format:
[TOKEN_MINT] [AMOUNT][UNIT] [#_BUYS] [FREQ_HRS] [STOP_ABOVE]? [STOP_BELOW]?

Examples:
7GC… 1sol   4 1               → Buy 0.25 SOL every hour
7GC… 50usdc 5 2 0.65 0.45     → Buy 10 USDC every 2 h if $0.45 – $0.65
7GC… 50usdc 5 2  -   0.45     → Buy only if ≤ $0.45
7GC… 50usdc 5 2 0.65 -        → Buy only if ≥ $0.65`;

  /* live preview sentence */
  const dcaPreview = () => {
    if (!dcaMint || !dcaAmount || !dcaBuys || !dcaFreqHrs) return null;
  
    const unitLabel = dcaUnit.toUpperCase();
    const amountPerBuy = (Number(dcaAmount) / Number(dcaBuys)).toFixed(2);
  
    const eachChunk =
      dcaSide === "buy"
        ? `Buy ${amountPerBuy} ${unitLabel}`
        : `Sell ${amountPerBuy} ${unitLabel}`;
  
    const every = dcaFreqHrs === "1" ? "hour" : `${dcaFreqHrs} h`;
    const hi = dcaStopHigh ? ` • stop ≥ $${dcaStopHigh}` : "";
    const lo = dcaStopLow  ? ` • stop ≤ $${dcaStopLow}`  : "";
  
    return `${eachChunk} every ${every} • ${dcaBuys} rounds${hi}${lo}`;
  };

  return (
    <div className="advanced-orders border-t border-zinc-700 pt-6 mt-6">
      {/* accordion trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between
                   bg-zinc-800 hover:bg-zinc-700
                   text-sm font-semibold px-4 py-2 rounded">
        <span>Advanced Orders (Limit & DCA)</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {!open ? null : (
        <div className="space-y-8">

          {/* ─────────── LIMIT ─────────── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold text-purple-400">🎯 Limit Order</h4>
              <Popover>
                <PopoverTrigger asChild>
                  <HelpCircle size={14} className="cursor-pointer text-zinc-400" />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
                  {limitHelp}
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-wrap gap-3">
            <select
                className="rounded bg-zinc-800 px-3 py-2 text-sm"
                value={limitSide}
                onChange={e => setLimitSide(e.target.value)}>
                <option value="buy">Buy ⬇</option>
                <option value="sell">Sell ⬆</option>
              </select>

              <input
                className="w-28 rounded bg-zinc-800 px-3 py-2 text-sm"
                placeholder="Token mint"
                value={limitMint}
                onChange={e => setLimitMint(e.target.value)}
              />

              <input
                className="w-28 rounded bg-zinc-800 px-3 py-2 text-sm"
                type="number"
                step="0.0001"
                placeholder="Target $"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
              />

              <input
                className="w-36 rounded bg-zinc-800 px-3 py-2 text-sm"
                type="number"
                step="0.01"
                placeholder="Amount (USDC)"
                value={limitAmount}
                onChange={e => setLimitAmount(e.target.value)}
              />
              <ForceToggle
                value={limitForce}
                onChange={setLimitForce}
              />

              <button
                className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-700"
                onClick={handleLimitSave}>
                Save Limit
              </button>
            </div>
            {/* live preview */}
            {limitPreview() && (
              <p className="mt-1 text-xs text-zinc-400">
                {limitPreview()}
              </p>
            )}
          </section>

          {/* ─────────── DCA ──────────── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold text-emerald-400">♻️ DCA Order</h4>
              <Popover>
                <PopoverTrigger asChild>
                  <HelpCircle size={14} className="cursor-pointer text-zinc-400" />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
                  {dcaHelp}
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-wrap gap-3">
              {/* BUY / SELL selector */}
              <select
                className="rounded bg-zinc-800 px-3 py-2 text-sm"
                value={dcaSide}
                onChange={e => setDcaSide(e.target.value)}>
                <option value="buy">Buy ⬇</option>
                <option value="sell">Sell ⬆</option>
              </select>

              <input
                className="w-28 rounded bg-zinc-800 px-3 py-2 text-sm"
                placeholder="Token mint"
                value={dcaMint}
                onChange={e => setDcaMint(e.target.value)}
              />

              <input
                className="w-28 rounded bg-zinc-800 px-3 py-2 text-sm"
                type="number"
                min="0"
                placeholder="Amount"
                value={dcaAmount}
                onChange={e => setDcaAmount(e.target.value)}
              />

              <select
                className="rounded bg-zinc-800 px-2 py-2 text-sm"
                value={dcaUnit}
                onChange={e => setDcaUnit(e.target.value)}>
                <option value="usdc">USDC</option>
                <option value="sol">SOL</option>
              </select>

              <input
                className="w-24 rounded bg-zinc-800 px-3 py-2 text-sm"
                type="number"
                min="1"
                placeholder="# Buys"
                value={dcaBuys}
                onChange={e => setDcaBuys(e.target.value)}
              />

              <input
                className="w-24 rounded bg-zinc-800 px-3 py-2 text-sm"
                type="number"
                min="1"
                placeholder="Freq hrs"
                value={dcaFreqHrs}
                onChange={e => setDcaFreqHrs(e.target.value)}
              />

              <input
                className="w-24 rounded bg-zinc-800 px-3 py-2 text-xs"
                type="number"
                step="0.0001"
                placeholder="Stop ≥ $"
                value={dcaStopHigh}
                onChange={e => setDcaStopHigh(e.target.value)}
              />

              <input
                className="w-24 rounded bg-zinc-800 px-3 py-2 text-xs"
                type="number"
                step="0.0001"
                placeholder="Stop ≤ $"
                value={dcaStopLow}
                onChange={e => setDcaStopLow(e.target.value)}
              />

            <ForceToggle value={dcaForce} onChange={setDcaForce} />
            <button
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700"
              onClick={handleDcaSave}>
              Save DCA
            </button>
            </div>

            {/* live preview */}
            {dcaPreview() && (
              <p className="mt-1 text-xs text-zinc-400">
                {dcaPreview()}
              </p>
            )}
          </section>

        </div>
      )}
    </div>
  );
}