import { useState, useEffect } from "react";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  BarChart, BadgeCheck, XCircle, Trophy, Skull
} from "lucide-react";
import {fetchRecap } from "../../utils/trades_positions"
export default function RecapSheet({
  triggerLabel = "View Daily Performance",
  triggerClassName = ""
}) {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchAndSetRecap = async () => {
    setLoading(true);
    try {
      const data = await fetchRecap();
      setRecap(data);
    } catch (err) {
      console.error("❌ Recap fetch:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecap(); }, []);
         // <BarChart className="h-4 w-4" />

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`gap-2 text-sm font-medium ${triggerClassName}`}
        >
          {triggerLabel}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[420px] p-6 space-y-6">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BarChart className="text-blue-400" />
          Daily Performance Summary
          {recap?.date && (
            <span className="text-zinc-400 text-sm">({recap.date})</span>
          )}
        </h3>


        <Button size="sm" onClick={fetchRecap} disabled={loading}>
          Refresh Recap
        </Button>

        {loading && <p className="text-sm text-zinc-400">Loading…</p>}

        {recap && !loading && (
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <div>Total Trades</div><div>{recap.totalTrades}</div>
            <div className="flex items-center gap-1">
              <BadgeCheck className="h-4 w-4 text-green-400" /> Wins
            </div><div>{recap.wins}</div>
            <div className="flex items-center gap-1">
              <XCircle className="h-4 w-4 text-red-400" /> Losses
            </div><div>{recap.losses}</div>
            <div>Net PnL</div>
            <div>
            {typeof recap.netPnL === "number"
                ? `${recap.netPnL.toFixed(2)}%`
                : "-"}
            </div>            
            <div className="flex items-center gap-1">
              <Trophy className="h-4 w-4 text-yellow-400" /> Best
            </div>
            <div>
              {recap.bestTrade
            ? `${recap.bestTrade.tokenName} @ ${
                typeof recap.bestTrade.gainLossPct === "number"
                    ? recap.bestTrade.gainLossPct.toFixed(2)
                    : "-"
                }%`
            : "N/A"}

            </div>
            <div className="flex items-center gap-1">
              <Skull className="h-4 w-4 text-pink-400" /> Worst
            </div>
            <div>
              {recap.worstTrade
            ? `${recap.worstTrade.tokenName} @ ${
                typeof recap.worstTrade.gainLossPct === "number"
                    ? recap.worstTrade.gainLossPct.toFixed(2)
                    : "-"
                }%`
            : "N/A"}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
