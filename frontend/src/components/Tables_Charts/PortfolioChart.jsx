/* ------------------------------------------------------------------
   PortfolioChart.jsx – equity curve for the Solana bot dashboard
   v3 • polished styling, nicer padding, sorted data, axis tweaks
-------------------------------------------------------------------*/
import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  getNetWorthHistory,
  getNetWorthSummary,
} from "@/utils/trades_positions";
import "@/styles/components/PortfolioChart.css";

/* ── constants ─────────────────────────────────────────── */
const POLL_MS = 60_000;                  // refresh every 60 s
const MAXPTS  = 2_880;                   // 48 h @ 60 s → mem-safe

const RANGES = {
  "1h":  60 * 60 * 1e3,
  "1d":  24 * 60 * 60 * 1e3,
  "1w":   7 * 24 * 60 * 60 * 1e3,
  "1m":  30 * 24 * 60 * 60 * 1e3,
  "3m":  90 * 24 * 60 * 60 * 1e3,
  "1y": 365 * 24 * 60 * 60 * 1e3,
  all : Infinity,
};

export default function PortfolioChart() {
  const [equity, setEquity] = useState([]); // [{ ts, value, minute? }]
  const [range,  setRange]  = useState("1m");
  const timer               = useRef(null);

  /* 0️⃣  load snapshots (sorted once) */
  useEffect(() => {
    getNetWorthHistory()
      .then(rows => rows.sort((a, b) => a.ts - b.ts))      // NEW
      .then(setEquity)
      .catch(() => {});
  }, []);

  /* helper: append live snapshot (hourly-type) */
  const pushPoint = (v, ts = Date.now()) => {
    // const minute = new Date(ts).toISOString().slice(0, 16);
    // setEquity(arr =>
    //   [...arr.slice(-(MAXPTS - 1)), { ts, value:+v.toFixed(2), minute }]
    // );
    setEquity(arr => [...arr.slice(-(MAXPTS - 1)), { ts, value:+v.toFixed(2) }]);
  };

  /* fetch snapshot via lightweight /summary */
  const fetchSnapshot = async () => (await getNetWorthSummary()).netWorth;

  /* 1️⃣  first snapshot immediately */
  useEffect(() => { fetchSnapshot().then(pushPoint).catch(() => {}); }, []);

  /* 2️⃣  live poll every minute */
  useEffect(() => {
    timer.current = setInterval(() => {
      fetchSnapshot().then(pushPoint).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  /* 3️⃣  slice + sort each render (keeps safety if pushPoint races) */
  const now  = Date.now();
  const data = useMemo(() => {
    if (!equity.length) return [];
    const sorted   = [...equity].sort((a, b) => a.ts - b.ts);   // NEW
    const cutoff   = now - RANGES[range] - 12 * 60 * 60 * 1000; // pad 12 h
    const isShort  = ["1h", "1d", "1w", "1m"].includes(range);

    return sorted.filter(p => {
      const isHourly = !!p.minute;
      if (isShort)          return p.ts >= cutoff;  // 1h-1m use daily rows
       if (range === "all")  return true;            // all = show everything
       return p.ts >= cutoff;                        // 3m / 1y use monthly rows
    });
  }, [equity, range, now]);

  /* headline stats */
  const diff = data.length > 1 ? data.at(-1).value - data[0].value : 0;
  const pct  = data.length > 1 ? ((diff / data[0].value) * 100).toFixed(2) : "0.00";

  /* axis tick formatters */
  const tickFmt = ts => {
    const d = new Date(ts);
    return RANGES[range] <= RANGES["1d"]
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString();
  };

  const hasData = data.length >= 1;

  /* ── UI ─────────────────────────────────────────────── */
  return (
    <div className="portfolio-chart-container">
      {/* header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold">💼 Portfolio</h3>
          {hasData && (
            <div className="text-3xl font-bold mt-1">
              ${data.at(-1).value.toLocaleString(undefined,{minimumFractionDigits:2})}
            </div>
          )}
        </div>
        {hasData && (
          <div
            className={`mt-1 text-lg font-semibold ${

              diff >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {diff >= 0 ? "▲" : "▼"} {diff.toFixed(2)} USD&nbsp;({pct}%)
          </div>
        )}
      </div>

      {/* range pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.keys(RANGES).map(k => (
          <button
            key={k}
            onClick={() => setRange(k)}
            className={`px-3 py-1 rounded-full transition-colors
              ${range === k
                ? "bg-sky-600 text-white shadow-sm"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>

      {/* chart */}
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 12, left: 0, bottom: 24 }}  // NEW
          >
            {/* gradient */}
            <defs>
              <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#38bdf8" stopOpacity={0.7} /> {/* sky-400 */}
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05}/>
              </linearGradient>
            </defs>

            {/* subtle grid */}

            {/* X-axis */}
            <XAxis
              dataKey="ts"
              tickFormatter={tickFmt}
              tick={{ fill:"#9ca3af", fontSize:12 }}   // NEW
              axisLine={false} tickLine={false}       // NEW
              padding={{ left: 6, right: 6 }}          // NEW
              minTickGap={35}
            />

            {/* Y-axis with padding */}
            <YAxis
              width={70}
              tick={{ fill:"#9ca3af", fontSize:12 }}    // NEW
              axisLine={false} tickLine={false}        // NEW
              domain={[
                dataMin => +(dataMin * 0.97).toFixed(2),  // 3 % bottom pad
                dataMax => +(dataMax * 1.03).toFixed(2),  // 3 % top pad
              ]}
            />

            {/* Tooltip */}
            <Tooltip
              formatter={v => `$${v.toFixed(2)}`}
              labelFormatter={ts => new Date(ts).toLocaleString()}
              contentStyle={{ background:"#1f2937", border:"none" }}      // NEW
              labelStyle={{ color:"#f4f4f5" }}
            />

            {/* equity area */}
            <Area
              type="monotone"
              dataKey="value"
              stroke="#38bdf8"                   // sky-400
              strokeWidth={2}                   // NEW
              fill="url(#eq-grad)"
              isAnimationActive={false}
              dot={false}                       // NEW – clean line
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-sm text-zinc-400 mt-6">
          No portfolio data yet — waiting for your first snapshot 📊
        </p>
      )}
    </div>
  );
}
