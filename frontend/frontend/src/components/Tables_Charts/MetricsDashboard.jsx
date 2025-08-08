/*
  MetricsDashboard.jsx – Investor-facing performance metrics

  This component computes and displays aggregated performance metrics
  based off of the historical closed trade data that lives in the
  application database.  It is designed to be plugged into the
  HistoryPanel as a third tab (alongside Trades and Portfolio) to
  provide investors and power‑users with an at‑a‑glance view into
  how well their bots are performing.  All calculations are done
  client side using the same dataset returned by getFullTradeHistory()
  so there are no additional API dependencies.

  Metrics exposed:
    – Total trades executed
    – Total volume traded (USD)
    – Average ROI (%) per trade
    – Win rate (percentage of profitable trades)
    – Unique wallets traded
    – Strategy level breakdown (trades, avg ROI, win rate)
    – Live vs. paper trader performance
    – Maximum drawdown (USD)

  The component renders a simple responsive grid for the headline
  metrics followed by a table for per‑strategy statistics.  Styling
  follows the same colour palette used elsewhere in the dashboard.
*/

import React, { useMemo } from "react";

/* Helper: compute the USD size of a trade.  A trade can be either
   denominated in USDC (lamports) or SOL.  When tradeSizeUSD is
   provided (e.g. from monthly aggregates) that value is used
   directly.  Otherwise, the size is derived from inAmount / outAmount
   and the known entry price in USD. */
const tradeSizeUSD = (t) => {
  if (typeof t.tradeSizeUSD === "number") {
    return t.tradeSizeUSD;
  }
  // when unit is USDC, inAmount represents lamports (1e6 multiplier)
  if (t.unit === "usdc" || t.unit === "USDC") {
    return Number(t.inAmount) / 1e6;
  }
  // otherwise compute size via entry price (fallback to exit price if needed)
  const qty = Number(t.outAmount) / 10 ** (t.decimals ?? 9);
  const price = t.entryPriceUSD ?? t.exitPriceUSD ?? 0;
  return qty * price;
};

/* Helper: compute USD PnL for a trade.  We multiply the difference
   in USD price by the quantity traded.  If price data is missing
   (e.g. import rows) the PnL is zero. */
const tradeUsdPnL = (t) => {
  if (t.entryPriceUSD == null || t.exitPriceUSD == null) return 0;
  const qty = Number(t.outAmount) / 10 ** (t.decimals ?? 9);
  return (t.exitPriceUSD - t.entryPriceUSD) * qty;
};

/* Helper: compute ROI percentage for a trade.  If either price is
   missing the return value is null. */
const tradeROI = (t) => {
  if (t.entryPriceUSD == null || t.exitPriceUSD == null) return null;
  if (t.entryPriceUSD === 0) return null;
  return ((t.exitPriceUSD - t.entryPriceUSD) / t.entryPriceUSD) * 100;
};

export default function MetricsDashboard({ trades = [] }) {
  // Compute all headline metrics in a single memoised pass.  Doing
  // calculations inside useMemo prevents unnecessary recomputations on
  // each render and improves responsiveness on large datasets.
  const {
    totalTrades,
    totalVolume,
    averageROI,
    winRate,
    uniqueWallets,
    strategyData,
    liveStats,
    paperStats,
    maxDrawdown,
  } = useMemo(() => {
    const countsByStrategy = {};
    let tradesCount = 0;
    let volumeSum = 0;
    let roiSum = 0;
    let roiCount = 0;
    let winCount = 0;
    const walletIds = new Set();
    // live and paper trackers
    let liveRoiSum = 0,
      liveRoiCount = 0,
      liveWins = 0,
      liveTrades = 0;
    let paperRoiSum = 0,
      paperRoiCount = 0,
      paperWins = 0,
      paperTrades = 0;
    // sequence for drawdown computation
    const pnlSequence = [];

    for (const t of trades) {
      tradesCount += 1;
      const vol = tradeSizeUSD(t) || 0;
      volumeSum += vol;
      // accumulate ROI if price data present
      const roi = tradeROI(t);
      if (roi != null) {
        roiSum += roi;
        roiCount += 1;
        if (roi > 0) winCount += 1;
      }
      // track wallet uniqueness using either walletId or walletLabel
      if (t.walletId != null) walletIds.add(String(t.walletId));
      else if (t.walletLabel) walletIds.add(t.walletLabel);
      // per‑strategy aggregator
      const strat = t.strategy || "unknown";
      if (!countsByStrategy[strat]) {
        countsByStrategy[strat] = {
          trades: 0,
          roiSum: 0,
          roiCount: 0,
          wins: 0,
        };
      }
      const s = countsByStrategy[strat];
      s.trades += 1;
      if (roi != null) {
        s.roiSum += roi;
        s.roiCount += 1;
        if (roi > 0) s.wins += 1;
      }
      // live vs paper split
      if (strat === "Paper Trader" || strat === "paperTrader") {
        paperTrades += 1;
        if (roi != null) {
          paperRoiSum += roi;
          paperRoiCount += 1;
          if (roi > 0) paperWins += 1;
        }
      } else {
        liveTrades += 1;
        if (roi != null) {
          liveRoiSum += roi;
          liveRoiCount += 1;
          if (roi > 0) liveWins += 1;
        }
      }
      // record PnL for drawdown
      pnlSequence.push(tradeUsdPnL(t));
    }

    // build strategy table
    const strategyData = Object.entries(countsByStrategy).map(
      ([strategy, s]) => {
        const avgRoi = s.roiCount ? s.roiSum / s.roiCount : 0;
        const winPct = s.roiCount ? (s.wins / s.roiCount) * 100 : 0;
        return {
          strategy,
          trades: s.trades,
          avgRoi,
          winRate: winPct,
        };
      }
    );
    strategyData.sort((a, b) => b.avgRoi - a.avgRoi);

    // compute max drawdown from cumulative PnL sequence
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const pnl of pnlSequence) {
      cumulative += pnl;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
      totalTrades: tradesCount,
      totalVolume: volumeSum,
      averageROI: roiCount ? roiSum / roiCount : 0,
      winRate: roiCount ? (winCount / roiCount) * 100 : 0,
      uniqueWallets: walletIds.size,
      strategyData,
      liveStats: {
        trades: liveTrades,
        avgRoi: liveRoiCount ? liveRoiSum / liveRoiCount : 0,
        winRate: liveRoiCount ? (liveWins / liveRoiCount) * 100 : 0,
      },
      paperStats: {
        trades: paperTrades,
        avgRoi: paperRoiCount ? paperRoiSum / paperRoiCount : 0,
        winRate: paperRoiCount ? (paperWins / paperRoiCount) * 100 : 0,
      },
      maxDrawdown,
    };
  }, [trades]);

  // format numbers nicely for display
  const formatUsd = (val) =>
    `$${val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formatPct = (val) => `${val.toFixed(2)} %`;

  return (
    <div className="panel-card-glass space-y-6">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        📊 Performance Metrics
      </h3>
      {/* Headline metrics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Total Trades</div>
          <div className="text-2xl font-bold text-blue-300">
            {totalTrades}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Total Volume Traded</div>
          <div className="text-2xl font-bold text-green-400">
            {formatUsd(totalVolume)}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Average ROI</div>
          <div
            className={
              averageROI >= 0
                ? "text-2xl font-bold text-emerald-400"
                : "text-2xl font-bold text-red-500"
            }
          >
            {formatPct(averageROI)}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Win Rate</div>
          <div
            className={
              winRate >= 50
                ? "text-2xl font-bold text-emerald-400"
                : "text-2xl font-bold text-red-500"
            }
          >
            {formatPct(winRate)}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Unique Wallets</div>
          <div className="text-2xl font-bold text-indigo-300">
            {uniqueWallets}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Max Drawdown</div>
          <div className="text-2xl font-bold text-red-500">
            {formatUsd(maxDrawdown)}
          </div>
        </div>
        <div className="p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Live Avg ROI</div>
          <div
            className={
              liveStats.avgRoi >= 0
                ? "text-2xl font-bold text-emerald-400"
                : "text-2xl font-bold text-red-500"
            }
          >
            {formatPct(liveStats.avgRoi)}
          </div>
        </div>
        <div className="metric-box p-4 bg-zinc-800 rounded shadow">
          <div className="text-xs text-zinc-400">Paper Avg ROI</div>
          <div
            className={
              paperStats.avgRoi >= 0
                ? "text-2xl font-bold text-emerald-400"
                : "text-2xl font-bold text-red-500"
            }
          >
            {formatPct(paperStats.avgRoi)}
          </div>
        </div>
      </div>
      {/* Strategy breakdown table */}
      <div className="mt-6">
        <h4 className="text-lg font-semibold mb-3">Strategy Breakdown</h4>
        {strategyData.length === 0 ? (
          <p className="text-sm text-zinc-400">No trades to display.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-zinc-200">
              <thead>
                <tr className="border-b border-zinc-700">
                  <th className="text-left px-2 py-1">Strategy</th>
                  <th className="text-left px-2 py-1">Trades</th>
                  <th className="text-left px-2 py-1">Avg ROI</th>
                  <th className="text-left px-2 py-1">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {strategyData.map((s) => (
                  <tr
                    key={s.strategy}
                    className="border-b border-zinc-700 hover:bg-zinc-800"
                  >
                    <td className="px-2 py-1 capitalize flex gap-1 items-center">
                      {s.strategy}
                    </td>
                    <td className="px-2 py-1">{s.trades}</td>
                    <td
                      className={
                        s.avgRoi >= 0
                          ? "px-2 py-1 text-emerald-400"
                          : "px-2 py-1 text-red-500"
                      }
                    >
                      {formatPct(s.avgRoi)}
                    </td>
                    <td
                      className={
                        s.winRate >= 50
                          ? "px-2 py-1 text-emerald-400"
                          : "px-2 py-1 text-red-500"
                      }
                    >
                      {formatPct(s.winRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}