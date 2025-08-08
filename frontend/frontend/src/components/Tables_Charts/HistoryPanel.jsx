import React, { useEffect, useState } from "react";
import { downloadTradeCSV } from "@/utils/trades_positions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import TradeTable from "@/components/Tables_Charts/TradeTable";
import TradeChart from "@/components/Tables_Charts/TradeChart";
import PortfolioChart from "@/components/Tables_Charts/PortfolioChart";
import MetricsDashboard from "./MetricsDashboard";
import { getFullTradeHistory } from "@/utils/trades_positions";
import RecapSheet from "./RecapSheet";
import "@/styles/components/HistoryPanel.css";

// ✅ add this:
const daysAgo = (d) =>
  new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

export default function HistoryPanel({
  chartMode = "trades",
  setChartMode,
  timeframe = 30,
  setTimeframe,
  onExportCSV,
  onClearLogs,
}) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartWindow, setChartWindow] = useState("1M"); 
  const [autoRestart, setAutoRestart] = useState(() => {
    return JSON.parse(localStorage.getItem("autoRestart")) || false;
  });

  

  useEffect(() => {
    getFullTradeHistory()
      .then((arr) => {
        setTrades(arr.reverse());
        setLoading(false);
      })
      .catch((err) => {
        console.error("❌ Error fetching trade history:", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem("autoRestart", JSON.stringify(autoRestart));
  }, [autoRestart]);

  if (loading) return <p className="p-4">Loading full trade history…</p>;


  /* ── file download helpers ─────────────────────────────── */
  const downloadFile = (data, fname) => {
    const blob = new Blob([data], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTaxCSV = async () => {
    const csv = await downloadTradeCSV({
      from: daysAgo(60),          // 60-day fixed window
      preset: "tax",
    });
    downloadFile(csv, `tax-report-${Date.now()}.csv`);
  };

  const daysMap = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365, All: null };
const exportRawCSV = async () => {
  const days = daysMap[chartWindow];
  const from = days ? daysAgo(days) : undefined;   // All = unlimited
  const csv = await downloadTradeCSV({ from, preset: "raw" });
  downloadFile(csv, `trades-${chartWindow}-${Date.now()}.csv`);
};

  return (
    <div className="flex flex-col gap-8 px-4 pb-12 max-w-6xl mx-auto">
      {/* ╭───────────────────────── Unified Chart Card ─────────────────────╮ */}
      <div className="panel-card-glass space-y-4">
        {/* Header row with left recap, centered tabs, right actions */}
        <div className="panel-header-glass relative flex items-center justify-between">
          {/* Left Recap Button */}
          <div>
            <RecapSheet
              autoRestart={autoRestart}
              setAutoRestart={setAutoRestart}
              triggerLabel="📊 Check Daily Recap"
              triggerClassName="bg-zinc-800 text-blue-300 hover:text-blue-400 border border-zinc-700 px-3 py-1 rounded text-sm shadow"
            />
          </div>

          {/* Centered Tabs */}
          <div className="absolute left-1/2 -translate-x-1/2 flex gap-1">
            {[
              ["trades", "Trades"],
              ["portfolio", "Portfolio"],
              ["metrics", "Metrics"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setChartMode(key)}
                className={`tab-btn ${chartMode === key ? "active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>

          {chartMode === "trades" && (
            <div className="absolute right-0 flex gap-3">
              {/* ▾ dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="action-btn">⬇ Export CSV ▾</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
               <DropdownMenuItem onSelect={exportTaxCSV}>
                  Tax Report (60 days)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportRawCSV}>
                  Trade Log (Selected TimeFrame)
                </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <button onClick={onClearLogs} className="action-btn">
                Clear Logs
              </button>
            </div>
          )}

        </div>

        {/* Chart / portfolio / metrics area */}
        {chartMode === "trades" ? (
          <TradeChart
            sessionTrades={trades}
            timeframe={timeframe}
            onWindowChange={setChartWindow}
          />
        ) : chartMode === "portfolio" ? (
          <PortfolioChart timeframe={timeframe} />
        ) : (
          <MetricsDashboard trades={trades} />
        )}
      </div>
      {/* ╰───────────────────────────────────────────────────────────────╯ */}

      {/* Table view under chart – only show on Trades tab */}
      {chartMode === "trades" && (
        <div className="overflow-x-auto">
          <TradeTable trades={trades} />
        </div>
      )}
    </div>
  );
}
