// components/ui/FieldTooltip.jsx
import { Info } from "lucide-react";

export default function FieldTooltip({ name }) {
  const content = {
    slippage: "Max % difference allowed between expected and executed price.",
    interval: "Time in seconds between trades (e.g. 3 seconds).",
    maxTrades: "Maximum number of trades before stopping.",
    stopLoss: "Auto-sell if price drops below this % from entry.",
    takeProfit: "Auto-sell if price rises above this % from entry.",
  }[name] || "Tooltip coming soon.";

  return (
    <div className="relative group flex items-center">
      <Info
        size={14}
        className="ml-1 text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div className="absolute left-5 top-[-4px] z-20 hidden group-hover:block 
                      bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600 
                      max-w-[220px] w-max shadow-lg">
        {content}
      </div>
    </div>
  );
}