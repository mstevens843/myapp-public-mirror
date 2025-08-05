/** TradeTable - Displays historical trade data in a compact table
 * 
 * Features: 
 * - Shows trade time, strategy, input/output tokens, in/out amounts, price impact, and status
 * - Beatuifuies raw data (timestamp, token abbreviations, strategy names
 * - Uses tooltips for token mints to preserve UX clarity. 
 * 
 * Optimizations: 
 * - Cleaner, timestamp formatting (HH:MM:SS) 
 * - Capitalized strategy names
 * - Tooltip titles for input/output
 * - Fixed precision handling for token amounts. 
 * 
 * - Used in the dashboard to review live or historical bot trade logs. 
 */

// components/Dashboard/TradeTable.jsx

/** TradeTable – full trade history with PnL & USD metrics */

// components/Dashboard/TradeTable.jsx
/** TradeTable – full closed-trade history with PnL & USD metrics */

/**
 * TradeTable – full closed-trade history with PnL & USD metrics
 * Mirrors the new Open Trades layout:
 * • Strategy filter pills (🧠 manual / 🎯 limit / 🪜 dca / …)
 * • Consistent strategy icons & colours
 * • Local sorting (Date ⇅ | %PnL ⇅ | Token ⇅ | Strategy ⇅)
 * • Big-move call-outs  🤑 (+20 %↑)   🩸 (-10 %↓)
 * • “Unknown” token names replaced from cache when available
 */

import React, { useMemo, useState, useEffect } from "react";
import { getTradeHistory } from "../../utils/trades_positions";
import "@/styles/components/TradeTable.css";

const PAGE_SIZE = 50; 

/* ───────── strategy meta (emoji + colour) ───────── */
const STRATEGY_META = {
  manual:        { icon: "🧠", color: "text-white"       },
  limit:         { icon: "🎯", color: "text-yellow-400"  },
  dca:           { icon: "🪜", color: "text-teal-400"    },
  sniper:        { icon: "🔫", color: "text-red-400"     },
  scalper:       { icon: "⚡",  color: "text-orange-400"  },
  breakout:      { icon: "🚀", color: "text-indigo-400"  },
  chadMode:      { icon: "🔥", color: "text-pink-500"    },
  dipBuyer:      { icon: "💧", color: "text-blue-300"    },
  trendFollower: { icon: "📈", color: "text-green-400"   },
  paperTrader:   { icon: "📝", color: "text-gray-400"    },
  rebalancer:    { icon: "⚖️", color: "text-purple-400" },
  rotationBot:   { icon: "🔁", color: "text-amber-400"  },
  stealthBot: { icon: "🥷 ", color: "text-black-400"  },

};

const LAMPORTS = 1e9;
// Strategies that should be ignored in the default “All (real)” view
const EXCLUDE_FROM_PNL = new Set(["Paper Trader"]);

// add latertp extra safetey deduplicaiton 
// add right above render map 

/* ─────────────────────────────────────────────────────────── */

export default function TradeTable() {                   // ← no prop needed now
  
    /* ------------- data + pagination ------------- */
    const [trades, setTrades] = useState([]);
    const [page,   setPage]   = useState(0);               // 0-based
    const [done,   setDone]   = useState(false);           // no more rows
    const [loading, setLoading] = useState(false);
  
    /* on mount → first page */
    useEffect(() => {
      loadPage(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  
    const loadPage = async (next) => {
      if (done || loading) return;
      setLoading(true);
  
      const offset = next * PAGE_SIZE;
      const rows = await getTradeHistory({ limit: PAGE_SIZE, offset });
  
    setTrades((prev) => next === 0 ? rows : [...prev, ...rows]);      setPage(next);
      if (rows.length < PAGE_SIZE) setDone(true);          // last page reached
      setLoading(false);
    };
  
    /* ------------- UI filter / sort state ------------- */  /* UI state */


  const [filter, setFilter]   = useState("all");   // "all" = real‑only      // strategy pill
  const [sortKey, setSortKey] = useState("date");     // date | pnl | token | strategy
  const [desc, setDesc]       = useState(true);       // sort dir

  /* sorting helper */
  /* helper – always sort / filter by *exit* time when present */
  const getTs = (row) =>
    new Date(row.exitedAt ?? row.timestamp).getTime();

  const handleSort = (key) => {
     setDesc(key === sortKey ? !desc : true);
     setSortKey(key);
   };


  /* filter then sort */
  const data = useMemo(() => {
const filtered =
  filter === "all"
    ? trades.filter((t) => !EXCLUDE_FROM_PNL.has(t.strategy))
    : trades.filter((t) => t.strategy === filter);


    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "pnl":
          return Number(b.pnlPct ?? 0) - Number(a.pnlPct ?? 0);
        case "strategy":
          return a.strategy.localeCompare(b.strategy);
        case "token":
          return (b.tokenName || "").localeCompare(a.tokenName || "");
        default:  // date
          return getTs(b) - getTs(a);
      }
    });
    return desc ? sorted : sorted.reverse();
  }, [trades, filter, sortKey, desc]);

  if (!trades.length)
    return (
      <div className="trade-table-container">
        <h3 className="mb-2 text-lg font-semibold">📊 Full Trade History</h3>
        <p className="opacity-70">No closed trades yet.</p>
      </div>
    );

  /* pill list */
const pills = [
  "all",
  ...Object.keys(STRATEGY_META).filter((s) => s !== "paperTrader"),
  "Paper Trader" // Match exact DB value
];

  return (
    <div className="trade-table-container">
      <h3 className="mb-3 text-lg font-semibold">📊 Full Trade History</h3>

      {/* strategy filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {pills.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition
              ${
                filter === p
                  ? "bg-white text-black shadow"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
          >
            {p === "Paper Trader"
  ? "📝 Paper Trader"
  : `${STRATEGY_META[p]?.icon || ""} ${p}`}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="trade-table w-full">
          <thead>
            <tr>
              <Th label="Date"      onClick={() => handleSort("date")} />
              <Th label="Time"      onClick={() => handleSort("date")} />
              <Th label="Token"     onClick={() => handleSort("token")} />
              <Th label="Entry ($)" />
              <Th label="Exit ($)"  />
              <Th label="% PnL"     onClick={() => handleSort("pnl")} />
              <Th label="$ PnL"     />
              <Th label="Spent / Exit ($)" />
              <Th label="Value ($)" />
              <Th label="Strategy"  onClick={() => handleSort("strategy")} />
            </tr>
          </thead>

          <tbody>
            {data.map((t, i) => {
              /* normalise so the table works with either side _or_ type */
              const side = t.side || t.type || "unknown";

              /* ─── price helpers ───────────────────────── */
              const type = t.type || "buy";
            const unit = t.unit || "usdc";

            const solUsd =
              t.exitPriceUSD && t.exitPrice
                ? t.exitPriceUSD / t.exitPrice
                : t.entryPriceUSD && t.entryPrice
                  ? t.entryPriceUSD / t.entryPrice
                  : 0;

            const spentUSD =
              unit === "sol"
                ? (Number(t.inAmount) / 1e9) * solUsd
                : Number(t.inAmount) / 1e6;

            const exitUSD =
              Number(t.outAmount) / 10 ** (t.decimals ?? 9) * (t.exitPriceUSD || 0);
                          /* tokens traded (for pnl calc) */
                          const tokens =
                            side === "buy"
                              ? Number(t.outAmount) / 10 ** (t.decimals ?? 9)
                              : Number(t.inAmount)  / 10 ** (t.decimals ?? 9);

              /* value in USD (post-trade) */
              const valueUSD =
                side === "sell"
                  ? t.usdValue ?? exitUSD
                  : spentUSD;

              /* % / $ PnL */
              // const pnlPct =
              //   t.entryPriceUSD && t.exitPriceUSD
              //     ? ((t.exitPriceUSD - t.entryPriceUSD) / t.entryPriceUSD) * 100
              //     : 0;

              // const pnlUSD =
              //   t.entryPriceUSD && t.exitPriceUSD
              //     ? tokens * (t.exitPriceUSD - t.entryPriceUSD)
              //     : 0;

               /* % / $ PnL  — true realised, not token-price delta */
              const pnlUSD = exitUSD - spentUSD;              // realised $
              const pnlPct = spentUSD > 0                    // realised %
                ? (pnlUSD / spentUSD) * 100
                : 0;

              /* formatting helpers */
              const d        = new Date(t.exitedAt ?? t.timestamp);
              const dateStr  = d.toLocaleDateString();
              const timeStr  = d.toLocaleTimeString([], {
                hour  : "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              const shortMint = (t.inputMint || t.outputMint || "");
              const mintPreview = `${shortMint.slice(0, 4)}…${shortMint.slice(-4)}`;
              const big   = pnlPct >= 20 ? "🤑" : pnlPct <= -10 ? "🩸" : "";
              const meta  = STRATEGY_META[t.strategy] || { icon: "", color: "" };

              return (
                <tr key={i}>
                  <td>{dateStr}</td>
                  <td>{timeStr}</td>
                    <td title={shortMint}>
                    {t.tokenName || mintPreview}
                  </td>
                  <td>{t.entryPriceUSD ? `$${t.entryPriceUSD.toFixed(6)}` : "—"}</td>
                  <td>{t.exitPriceUSD  ? `$${t.exitPriceUSD.toFixed(6)}`  : "—"}</td>
                  <td className={pnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {pnlPct.toFixed(2)}% {big}
                  </td>
                  <td className={pnlUSD >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    ${pnlUSD.toFixed(2)}
                  </td>
                  <td>{spentUSD.toFixed(2)} / {exitUSD.toFixed(2)}</td>
                  <td>${valueUSD.toFixed(2)}</td>
                  <td className={`flex items-center gap-1 ${meta.color}`}>
                    {meta.icon}
                    <span className="capitalize">
                      {t.strategy?.replace(/-?(tp|sl)$/i, "")}
                    </span>
                    {t.triggerType === "tp" && (
                      <span className="text-green-400 font-semibold">-TP</span>
                    )}
                    {t.triggerType === "sl" && (
                      <span className="text-rose-400 font-semibold">-SL</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {!done && (
        <button
          onClick={() => loadPage(page + 1)}
          disabled={loading}
          className="mx-auto mt-4 block rounded bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

/* small helper */
function Th({ label, onClick }) {
  return (
    <th
      onClick={onClick}
      className={onClick ? "sortable cursor-pointer select-none" : undefined}
    >
      {label}
    </th>
  );
}


/** Optimizations: 
 * - Cleaner Timestamp 
 * - Strategy Name Capitalized 
 * - Tooltips for token mints
 * - Precision handling for in/out comments
 * - Better formatting for a pro dashboard feel 
 */


/** 
 * Let me know if you want a:

🔍 Filter dropdown

📦 Export trades button

💬 Tooltip popup with trade details
 */