/* ------------------------------------------------------------------
   TradeChart.jsx – visualises closed-trade performance over time
   ──────────────────────────────────────────────────────────────────
   v2.2 • Adds “# Trades” metric + fixes USD trade-size
        • Monthly rows now support per-strategy filter
-------------------------------------------------------------------*/

import React, { useEffect, useState, useMemo } from "react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  ComposedChart,
  Line,
  Bar,
  Area,
} from "recharts";
import { getTradeHistory } from "../../utils/trades_positions";
import "@/styles/components/TradeChart.css";


const STRAT_COLOR = {
  sniper:   "#e11d48",
  scalper:  "#2563eb",
  breakout: "#16a34a",
  limit:    "#ea580c",
  dca:      "#0ea5e9",
  tpsl:     "#eab308",
  trendfollower:  "#9333ea",
  dipbuyer:  "#9333ea",
  chadmode:  "#9333ea",
  strealthbot:  "#9333ea",
  rotationbot:  "#9333ea",
  rebalancer:  "#9333ea",
  delayedsniper:  "#9333ea",
  "Paper Trader": "#9ca3af",
  default:  "#9333ea",
};

const SKY = "#38bdf8";
const POS = "#10b981";   // emerald-500
const NEG = "#ef4444";   // red-500

// top of file
const PAPER = "Paper Trader";
const EXCLUDE_FROM_PNL = new Set([PAPER]);

/* helper ─────────────────────────────────────────────────────────
   For a raw trade or a monthly aggregate row return:
     { usd: <net-PnL USD>,  size: <size USD> }
-----------------------------------------------------------------*/
/* universal helper: exit-aware timestamp */
const ts = (row) =>
  new Date(
    row.exitedAt ?? row.timestamp ?? `${row.month}-01T00:00:00Z`
  ).getTime();

const usdAndSize = (row) => {
  // ① monthly summary rows
  if (row.monthly) {
    return { usd: row.netUsd ?? 0, size: row.tradeSizeUSD ?? 0 };
  }
  // ② individual trades
  const qty  = Number(row.outAmount) / 10 ** (row.decimals ?? 9);
  const usd  = (row.exitPriceUSD - row.entryPriceUSD) * qty;
  const size =
    row.tradeSizeUSD ??
    (row.unit === "usdc"
      ? Number(row.inAmount) / 1e6
      : row.entryPriceUSD * qty);
  return { usd, size };
};

/* how many raw trades are inside a row */
const tradeCount = (row, strat = "all") =>
  row.monthly
    ? (strat === "all"
        ? row.totalTrades
        : row.strategies?.[strat]?.totalTrades ?? 0)
    : 1;


/* ─── universal USD math – works for raw trades OR monthly rows ─── */
const usdMeta = (row, strat = "all") => {
  /* monthly snapshot row */
  if (row.monthly) {
    const src = strat === "all" ? row : row.strategies?.[strat];
    if (!src) return { spentUSD: 0, exitUSD: 0, pnlUSD: 0 };
    const spent = src.tradeSizeUSD   ?? 0;   // entry-side USD
    const pnl   = src.netUsd         ?? 0;   // realised $PnL
    return { spentUSD: spent, exitUSD: spent + pnl, pnlUSD: pnl };
  }

  /* individual trade row */
  const tokens = Number(row.outAmount) / 10 ** (row.decimals ?? 9);

  const solUsd =
    row.exitPriceUSD && row.exitPrice
      ? row.exitPriceUSD / row.exitPrice
      : row.entryPriceUSD && row.entryPrice
        ? row.entryPriceUSD / row.entryPrice
        : 0;

  const spentUSD =
    row.unit === "usdc"
      ? Number(row.inAmount) / 1e6
      : (Number(row.inAmount) / 1e9) * solUsd;

  const exitUSD = tokens * (row.exitPriceUSD ?? 0);
  return { spentUSD, exitUSD, pnlUSD: exitUSD - spentUSD };
};



const DotByStrat = ({ cx, cy, payload }) => (
  <circle
    cx={cx}
    cy={cy}
    r={4}
    stroke="#0f0f0f"
    strokeWidth={1.5}
    fill={STRAT_COLOR[payload.strategy] ?? STRAT_COLOR.default}
  />
);

const WINDOW_OPTS = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  All : Infinity,
};

const MONTH_ABBR = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
];

/* ---------- helper: convert a raw row ➜ chart datapoint ---------- */
const point = (t, metric, stratFilter = "all") => {
  let y;

  /* ── aggregated MONTHLY rows ───────────────────────────── */
  if (t.monthly) {
 let src;
 if (stratFilter === "all") {
   /* aggregate without Paper Trader */
   const excl = t.strategies?.[PAPER] ?? {};
   src = {
     netUsd       : (t.netUsd        ?? 0) - (excl.netUsd        ?? 0),
     tradeSizeUSD : (t.tradeSizeUSD  ?? 0) - (excl.tradeSizeUSD  ?? 0),
     totalTrades  : (t.totalTrades   ?? 0) - (excl.totalTrades   ?? 0),
   };
   src.pnlPct = src.tradeSizeUSD
     ? (src.netUsd / src.tradeSizeUSD) * 100
     : 0;
 } else {
   src = t.strategies?.[stratFilter];
 }
    if (!src) return null;                           // no data for this strat

    switch (metric) {
      case "usd":    y = src.netUsd        ?? null; break;
      case "size":   y = src.tradeSizeUSD  ?? null; break;
      case "pnl":    y = src.pnlPct        ?? null; break;
      case "count":  y = src.totalTrades   ?? null; break;
      default:       y = src.netUsd        ?? null;
    }
  }

  /* ── individual trade rows ─────────────────────────────── */
  if (!t.monthly && y === undefined) {
    switch (metric) {
      case "usd":
        y =
          (t.exitPriceUSD - t.entryPriceUSD) *
          (Number(t.outAmount) / 10 ** (t.decimals ?? 9));
        break;
      case "pnl":
        y =
          t.gainLossPct ??
          (t.entryPriceUSD && t.exitPriceUSD
            ? ((t.exitPriceUSD - t.entryPriceUSD) / t.entryPriceUSD) * 100
            : null);
        break;
        case "size":
          // correct USD size: USDC spent if unit is usdc, otherwise value of tokens acquired
          y = t.tradeSizeUSD ?? (
                t.unit === "usdc"
                  ? Number(t.inAmount) / 1e6                        // USDC lamports ➜ USD
                  : t.entryPriceUSD * (Number(t.outAmount) / 10 ** (t.decimals ?? 9))
              );
          break;
      case "count":
        y = 1;
        break;
      default:
        y = Number(t.outAmount) / 10 ** (t.decimals ?? 9);
    }
  }

  /* X-axis label */
  const label = t.monthly
    ? (() => {
        const [y, m] = t.month.split("-");
        return `${MONTH_ABBR[+m - 1]} '${y.slice(-2)}`;
      })()
    : (() => {
        const d = new Date(t.exitedAt ?? t.timestamp);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      })();

  return { ...t, metric: y, label };
};


const formatUSD = (n) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


 export default function TradeChart({
   sessionTrades = [],
  timeframe,                // ← still here if other code uses it
  onWindowChange,           // 🔹 NEW PROP
 }) {  const [history, setHistory] = useState([]);
  const [live, setLive]       = useState(false);
  const [metric, setMetric]   = useState("usd");
const [windowK, setWindowK] = useState("1M");
  const [chart, setChart]     = useState("line");
  const [strat, setStrat]     = useState("all");

  useEffect(() => {
    if (onWindowChange) onWindowChange(windowK);
  }, [windowK, onWindowChange]);
  

  /* ── fetch once + poll when 🛰️ live ─────────────────── */
  useEffect(() => {
    const pull = () => {
      const days =
        WINDOW_OPTS[windowK] === Infinity ? 365 * 3 : WINDOW_OPTS[windowK];

      const now  = new Date();
      const from = new Date(now.getTime() - days * 86_400_000)
                     .toISOString().slice(0, 10);
      const to   = now.toISOString().slice(0, 10);

      getTradeHistory({ from, to }).then(setHistory).catch(() => {});
    };

    pull();
    if (!live) return;
    const id = setInterval(pull, 3_000);
    return () => clearInterval(id);
  }, [live, windowK]);

  /* ---------- filter + bucket ---------- */
  const data = useMemo(() => {
    const now   = Date.now();
    const since =
      windowK === "All" ? 0 : now - WINDOW_OPTS[windowK] * 86_400_000;

    const includeMonthly = WINDOW_OPTS[windowK] > 60; // ≥3 months

        /* ----- 1️⃣  de-duplicate monthly rows & trades ------------- */
    const dedup = new Map();
    [...sessionTrades, ...history].forEach(r => {
      const key = r.monthly
        ? `M-${r.month}`               // monthly row
        : r.txHash || r.id;            // individual trade
      if (!dedup.has(key)) dedup.set(key, r);
    });

    const raw = [...dedup.values()]      // ← use this from here down
      .filter((t) => (includeMonthly ? t.monthly : !t.monthly))
       .filter((t) => {
         if (t.monthly) return true;                   // handled later
      
         // 👇 default view drops Paper Trader
         if (strat === "all") {
           return !EXCLUDE_FROM_PNL.has(t.strategy);
         }
      
         // specific‑strategy view
         return (t.strategy ?? "").startsWith(strat);
       })
      .filter((t) => {
        if (t.monthly) {
          const [y, m] = t.month.split("-");
          const monthTS = new Date(y, m - 1, 1).getTime();
          return monthTS + 31 * 86_400_000 >= since;
        }
        return ts(t) >= since;
      });



      

    /* ---- 1-day window – no bucketing ---- */
        /* ---- 1-day window – no bucketing ---- */
        if (windowK === "1D") {
          const pts = raw.map((t) => point(t, metric, strat)).filter(Boolean);
          if (metric === "count") {
            let running = 0;
            for (const p of pts) running += p.metric, (p.metric = running);
          }
          return pts;
        }
    
        /* ---- includeMonthly branch ---- */
        if (includeMonthly) {
          return raw
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .map((t) => point(t, metric, strat))
            .filter(Boolean);
        }
    
        /* ---- hourly / daily buckets ---- */
        const isDaily = WINDOW_OPTS[windowK] >= 20 && !includeMonthly;
        const buckets = {};
    
        raw.forEach((t) => {
          const d   = new Date(t.exitedAt ?? t.timestamp);
          const key = isDaily
            ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
            : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${
                d.getHours() < 10 ? "0" : ""
              }${d.getHours()}:00`;
          (buckets[key] ||= []).push(t);
        });
    
        const series = Object.entries(buckets)
          .sort((a, b) => new Date(a[0]) - new Date(b[0]))
          .map(([label, rows]) => {
            const first = rows[0];
            const agg = rows.reduce((acc, r) => {
              const val = point(r, metric, strat)?.metric ?? 0;
              return acc + val;
            }, 0);
    
            const val = metric === "pnl" ? agg / rows.length : agg;
            return { label, metric: val, strategy: first.strategy };
          });
    
        if (metric === "count") {
          let running = 0;
          for (const p of series) running += p.metric, (p.metric = running);
        }
    
        return series;
  }, [sessionTrades, history, metric, windowK, strat]);

        /* ---------- headline summary (same logic as Portfolio) ---------- */
/* ---------- headline summary (small grey context + big number) ---------- */
 const summary = useMemo(() => {
   if (!data.length) return null;

   /* running totals + earliest trade ts */
   let spent=0, exit=0, pnl=0, trades=0, earliest=Date.now();
   const horizon = WINDOW_OPTS[windowK] * 86_400_000;

  [...sessionTrades, ...history].forEach(r => {
    if (strat === "all" && EXCLUDE_FROM_PNL.has(r.strategy)) return;
     const ts = new Date(r.timestamp || `${r.month}-01`).getTime();
     if (windowK!=="All" && ts < Date.now() - horizon) return;
     if (r.monthly && WINDOW_OPTS[windowK] <= 60)  return;
     if (!r.monthly && WINDOW_OPTS[windowK] >  60)  return;
     if (strat!=="all" && !(r.strategy ?? "").startsWith(strat)) return;

     const u = usdMeta(r, strat);
     spent  += u.spentUSD;
     exit   += u.exitUSD;
     pnl    += u.pnlUSD;
     trades += tradeCount(r, strat);
     earliest = Math.min(earliest, ts);
   });

   /* ---------- metric-specific payloads ---------- */
   if (metric === "size") {
     return {
       label    : "Avg Trade Size",
       val      : formatUSD(trades ? spent/trades : 0),
       headline : formatUSD(spent),           // big number
       color    : POS                         // always green
     };
   }

   if (metric === "count") {
     const days = windowK==="All"
       ? Math.max(1, (Date.now()-earliest)/86_400_000)
       : WINDOW_OPTS[windowK];
     return {
       label    : "Avg trades / day",
       val      : (trades/days).toFixed(1),
       headline : trades.toString(),
       color    : POS                         // always green
     };
   }

   /* $ PnL view (default) */
   const pct = spent ? (pnl/spent)*100 : 0;
   return {
     label       : "Spent / Exit",
     val         : `(${formatUSD(spent)} / ${formatUSD(exit)})`,
     label2      : "Trades",
     val2        : trades.toString(),
     headline    : `${pnl>=0?"+":""}${formatUSD(Math.abs(pnl))} (${pct.toFixed(2)} %)`,
     color       : pnl>=0 ? POS : NEG
   };
 }, [data, metric, windowK, strat, sessionTrades, history]);

  const yLabel = {
    usd  : "USD value",
    pnl  : "% gain/loss",
    size : "Trade size (USD)",
    count: "Trades",
  }[metric];

    // const stroke =
    // strat === "all"
    //   ? SKY                          // unified look
    //   : STRAT_COLOR[strat] ?? SKY;   // keep per-strat colours

     const isUp   = summary && (summary.pnl ?? 0) >= 0;
     const stroke = summary?.color ?? POS;

    // simple % helper – only show when we can work it out
     // average %-PnL over **the very same window**, regardless of
 // which $-based metric we’re plotting
    /* ── weighted %-PnL for the active window ─────────────────────── */
    const pctChange = (() => {
      if (windowK === "All") return null;           // nothing to compare 📉
    
      const since =
        Date.now() - WINDOW_OPTS[windowK] * 86_400_000; // ms since window start
    
      let usdSum = 0;
      let sizeSum = 0;
    
      [...sessionTrades, ...history]
        .filter((r) => {
          const ts = new Date(r.timestamp || `${r.month}-01`).getTime();
          return (
            ts >= since &&
            (strat === "all" || (r.strategy ?? "").startsWith(strat))
          );
        })
        .forEach((r) => {
          const { usd, size } = usdAndSize(r);
          usdSum += usd;
          sizeSum += size;
        });
    
      if (!sizeSum) return null;
      return ((usdSum / sizeSum) * 100).toFixed(2);   // e.g. “-1.29”
    })();

    
  /* ---------- UI ---------- */
  return (
    <div className="chart-container">
    {/* header row with title + summary */}
<div className="flex items-start justify-between mb-2">
  <h3 className="text-lg font-semibold">📈 Trade Performance Over Time</h3>

  {summary && (
    <div className="flex items-start gap-4">
      {/* grey context on the left */}
      <div>
        <div className="text-xs text-zinc-400">{summary.label}</div>
        <div className="text-sm text-zinc-300">{summary.val}</div>
      </div>

      {/* big headline on the right */}
      <div className="text-right leading-tight">
        <div
          className="text-2xl font-bold"
          style={{ color: summary.color }}
        >
          {summary.headline}
        </div>
      </div>
    </div>
  )}
</div>

      {/* controls */}
      <div className="filter-controls">
        {/* --- left --- */}
        <div className="flex gap-2 flex-wrap items-center">
          {Object.keys(WINDOW_OPTS).map((k) => (
            <button
              key={k}
              onClick={() => setWindowK(k)}
              className={`chart-mode-button ${
                windowK === k ? "active" : "inactive"
              }`}
            >
              {k}
            </button>
          ))}

          <label className="flex items-center gap-1">
            🧮
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="usd">$ PnL</option>
              <option value="size">Trade Size (USD)</option>
              <option value="count">Cumulative Trades</option>
            </select>
          </label>

          <label className="flex items-center gap-1">
            🎯
            <select value={strat} onChange={(e) => setStrat(e.target.value)}>
              <option value="all">All strategies</option>
              <option value="Paper Trader">Paper Trader</option>
              {Object.keys(STRAT_COLOR)
                .filter((k) => k !== "default")
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {/* --- right --- */}
        <div className="flex gap-2 items-center">
          {["line", "bar"].map((m) => (
            <button
              key={m}
              onClick={() => setChart(m)}
              className={`chart-mode-button ${
                chart === m ? "active" : "inactive"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}

          <label className="flex items-center gap-1">
            🛰️ Live
            <input
              type="checkbox"
              checked={live}
              onChange={() => setLive(!live)}
            />
          </label>
        </div>
      </div>

      {/* chart */}
      <ResponsiveContainer width="100%" height={360}>
          <ComposedChart
      data={data}
      margin={{ top: 10, right: 12, left: 0, bottom: 24 }} // extra breathing room
    >
          <defs>
            {/* sky-blue gradient like PortfolioChart */}
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={stroke} stopOpacity={0.70} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0.05} />
        </linearGradient>
       </defs>

           <XAxis
            dataKey="label"
            minTickGap={windowK === "1D" ? 25 : 60}
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 6, right: 6 }}
          />
          <YAxis
            width={80}
            domain={
              metric === "pnl"
                ? ["dataMin - 5", "dataMax + 5"]
                : ["auto", "auto"]
            }
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              fill: "#9ca3af",
            }}
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
      axisLine={false}
      tickLine={false}
            tickFormatter={(v) =>
              metric === "pnl"
                ? `${v.toFixed(1)}%`
                : metric === "usd" || metric === "size"
                ? `$${v.toFixed(2)}`
                : v
            }
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "none" }}
            labelStyle={{ color: "#fafafa" }}
            formatter={(val) =>
              metric === "pnl"
                ? `${val.toFixed(2)} %`
                : metric === "usd" || metric === "size"
                ? `$${val.toFixed(2)}`
                : val
            }
          />

          {chart === "line" && (
        /* “Line” → sky-gradient area */
        <Area
          type="monotone"
          dataKey="metric"
          stroke={stroke}
          fill="url(#chartFill)"
          dot={<DotByStrat />}
          isAnimationActive={false}
        />
      )}

      {chart === "bar" && (
        <Bar
          dataKey="metric"
          fill={stroke}
          isAnimationActive={false}
        />
      )}

        </ComposedChart>
      </ResponsiveContainer>

      {!data.length && (
        <p className="text-center text-sm text-gray-400 mt-2">
          No trades in this window.
        </p>
      )}
    </div>
  );
}
