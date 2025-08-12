// pages/OpenTradesTab.jsx
// July 2025 — glow pass (neutral pills removed) + Smart-Exit badges

import React, { useEffect, useState } from "react";
import { toast } from "sonner"; 
import {
  getPositions,
  getOpenTrades,
  fetchCurrentPrice,
  clearDustTrades,
  deleteOpenTrades,
} from "@/utils/trades_positions";
import { manualSell, fetchTpSlSettings } from "@/utils/api";
import TpSlCell         from "@/components/Dashboard/OpenTrades/TPSLCell";
import PendingOrdersTab from "@/components/Dashboard/OpenTrades/PendingOrdersTab";
import { formatLocalTimestamp } from "@/utils/timeFormatter";
import { useUser } from "@/contexts/UserProvider";

import {
  ChevronUp,
  ChevronDown,
  DollarSign,
  Loader2,
  RefreshCcw,
  Trash2,
  ExternalLink,
  XCircle,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────
 * Smart-Exit badge (time | volume | liquidity)
 * Expects trade.smartExit = {
 *   mode, smartExitTimeMins, smartVolLookbackSec, smartVolThreshold,
 *   smartLiqLookbackSec, smartLiqDropPct
 * }
 * ──────────────────────────────────────────────────────────────────── */
const MODE_LABELS = {
  time: "smart-time",
  volume: "smart-volume",
  liquidity: "smart-liquidity",
};

function SmartBadge({ trade }) {
  const meta = trade?.smartExit || {};
  const mode = meta.mode ?? meta.smartExitMode ?? "none";
  if (!mode || mode === "none") return null;

  let text = MODE_LABELS[mode] || mode;
  if (mode === "time" && meta.smartExitTimeMins != null)      text += `: ${meta.smartExitTimeMins}m`;
  if (mode === "volume" && meta.smartVolThreshold != null)    text += `: ${meta.smartVolThreshold}`;
  if (mode === "liquidity" && meta.smartLiqDropPct != null)   text += `: ${meta.smartLiqDropPct}%`;

  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[10px] font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500">
      {text}
    </span>
  );
}

function shortAddress(addr) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function mergePositionsWithTpSl(positions, tpSlRules) {
  return positions.map(pos => {
    const match = tpSlRules.find(
      r => r.mint === pos.mint && 
           r.walletId === pos.walletId &&
           r.strategy === pos.strategy
    );
    return {
      ...pos,
      tp       : match?.tp,
      tpPercent: match?.tpPercent,
      sl       : match?.sl,
      slPercent: match?.slPercent,
      sellPct  : match?.sellPct,
      tpSlId   : match?.id
    };
  });
}

/* strategy filter list */
const STRATS = [
  "manual","limit","dca","sniper","scalper",
  "breakout","chadMode","dipBuyer", "stealthbot", "rebalancer", 
  "rotationbot", "delayedsniper", "trendfollower", "paperTrader",  
];

/* pill helpers (only emerald + red chips now) */
const pill = (cls = "") =>
  `px-2 py-[1px] rounded-full text-xs font-semibold border ${cls}`;
const emerald = pill("bg-emerald-600/20 text-emerald-300 border-emerald-500");
const red     = pill("bg-rose-600/20    text-rose-300    border-rose-500");

export default function OpenTradesTab({ onRefresh }) {
  const { activeWalletId } = useUser();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tpSl, setTpSl] = useState({});
  const [positions, setPositions] = useState([]);
  const [tpSlRules, setTpSlRules] = useState([]);
  // 🆕 selected rows (rowKey = `${mint}_${strategy}`)
  const [selected, setSelected]   = useState(new Set());
  const [deleteMode, setDeleteMode] = useState(false);

  /* ─── TP/SL loader ─── */
  const loadTpSl = async () => {
    const arr = await fetchTpSlSettings("web", "default");   
    setTpSlRules(arr);   // just hold full array
  };

  const [filter, setFilter] = useState("All");
  const [tab, setTab] = useState("positions");   // positions | pending
  const [customSell, setCustomSell] = useState({});

  /* ─── data loader ─── */
  const load = async () => {
    setLoading(true);
    try {
      const posSnap = await getPositions();
      if (posSnap?.refetchOpenTrades) {
        console.log("🔁 Token injection occurred — refreshing trades...");
        await new Promise(r => setTimeout(r, 300)); // debounce to avoid race
      }
      const openTrades = await getOpenTrades();

      const solUSD = posSnap?.sol?.price || 0;
      const posArr = Array.isArray(posSnap?.positions) ? posSnap.positions : [];
      const snapPrice = {};
      posArr.forEach((p) => (snapPrice[p.mint] = p.price ?? 0));

      const buckets = {};
      for (const t of openTrades) {
        if (!t?.mint || !t?.outAmount) continue;
        const key = `${t.mint}_${t.strategy || "manual"}`;
        buckets[key] ??= { ...t, tokens: 0, spentUSD: 0 };
        const dec = t.decimals ?? 9;
        buckets[key].tokens   += Number(t.outAmount) / 10 ** dec;
        buckets[key].spentUSD +=
          t.unit === "sol"
            ? (Number(t.inAmount) / 1e9) * solUSD
            : Number(t.inAmount) / 1e6;
      }

      const priceCache = { ...snapPrice };
      const priceFor = async (m) =>
        priceCache[m] ?? (priceCache[m] = await fetchCurrentPrice(m));

      const built = await Promise.all(
        Object.values(buckets).map(async (b) => {
          if (b.tokens <= 0) return null;
          const priceUSD = await priceFor(b.mint);
          const valueUSD = b.tokens * priceUSD;
          const pnlUSD   = +(valueUSD - b.spentUSD).toFixed(2);
          const pnlPct   = b.spentUSD ? (pnlUSD / b.spentUSD) * 100 : 0;
          const posMatch =
            posArr.find(p => p.mint === b.mint) || {};
          const entryUSD = b.spentUSD && b.tokens ? b.spentUSD / b.tokens : null;

          // 🆕 Normalize smart-exit metadata for badge rendering
          const normalizedSmartExit = (() => {
            const m = b.smartExit || {};
            const mode = m.mode ?? b.smartExitMode ?? m.smartExitMode ?? "none";
            return {
              mode,
              smartExitTimeMins   : m.smartExitTimeMins    ?? b.smartExitTimeMins,
              smartVolLookbackSec : m.smartVolLookbackSec  ?? b.smartVolLookbackSec,
              smartVolThreshold   : m.smartVolThreshold    ?? b.smartVolThreshold,
              smartLiqLookbackSec : m.smartLiqLookbackSec  ?? b.smartLiqLookbackSec,
              smartLiqDropPct     : m.smartLiqDropPct      ?? b.smartLiqDropPct,
            };
          })();

          return {
            mint: b.mint,
            name : posMatch.name || b.tokenName || "Unknown",
            symbol: posMatch.symbol || "",        
            url: posMatch.url || "",  
            logo: posMatch.logo || "",          
            strategy: b.strategy,
            walletId: b.walletId,  
            entryUSD, // <–– cleanly injected here
            priceUSD,
            spentUSD: b.spentUSD === 0 ? 0 : b.spentUSD,
            valueUSD,
            pnlUSD,
            pnlPct,
            tokens: b.tokens,
            timestamp: b.timestamp,

            // 🆕 attach smart-exit meta for UI
            smartExit: normalizedSmartExit,
          };
        }),
      );

      setRows(built.filter(Boolean));
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const refresh = async () => {
    await Promise.all([load(), loadTpSl()]);   // rows + TP/SL in parallel
    onRefresh?.();
  };

  /* TP/SL map */
  useEffect(() => { loadTpSl(); }, []);

  /* sell – forward walletLabel **and** walletId */
  const sell = async (mint, strategy, frac, walletLabel = "", walletId = null) => {
    const pct = Math.round(frac * 100);
    const id = `sell-${mint}-${pct}`;
    toast.loading(`Selling ${pct}%…`, { id });
    try {
      await manualSell(frac, mint, { strategy, walletLabel, walletId });
      toast.success(`Sold ${pct}%`, { id });
      refresh();
    } catch (e) { toast.error(e.message, { id }); }
  };

  /* ─── selection helpers ─── */
  const toggleRow = (key) => {
    if (!deleteMode) return;               // only active in delete mode
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const exitDeleteMode = () => {
    setDeleteMode(false);
    setSelected(new Set());
  };
  const selectedRows = [...selected].map(k => {
    const [mint, strategy] = k.split("_");
    const row = rows.find(r => r.mint === mint && r.strategy === strategy);
    return row ? { mint, walletId: row.walletId } : null;
  }).filter(Boolean);

  const visible  = filter === "All" ? rows : rows.filter(r => r.strategy === filter);
  const merged = mergePositionsWithTpSl(visible, tpSlRules);
  const hasDust = merged.some(r => (r.tokens <= 0 || r.tokens < 0.000001));
  const showTpSl = true;
  const columnCount = 8; // Token | Entry/Cur | PnL | Spent→Value | Strategy | Exit Rule | TP/SL | Sell
  const totalUsd = merged
    .filter(r => r.strategy !== "paperTrader")   // ← exclude fake capital
    .reduce((s, r) => s + r.valueUSD, 0).toFixed(2);

  /* ─── JSX ─── */
  return (
    <div className="max-w-6xl mx-auto space-y-6 rounded-2xl border border-zinc-700 bg-zinc-900/90 p-6 shadow-xl animate-fade-in-down">
      {/* header */}
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-200 drop-shadow-[0_0_6px_rgba(99,102,241,0.65)]">
          Open Trades
        </h2>
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 ring-1 ring-zinc-700 hover:ring-indigo-500/40 transition">
            <RefreshCcw size={14}/> Refresh
          </button>

          {/* Clean Dust – always visible, disabled if none */}
          <button
            disabled={!hasDust}
            onClick={async () => {
              try {
                // pass the wallet id from context
                await clearDustTrades(activeWalletId);
                toast.success("🧹 Cleared dust trades.");
                refresh();
              } catch (err) {
                toast.error(err.message);
              }
            }}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm border transition
              ${hasDust
                ? "bg-rose-600/20 text-rose-300 border-rose-600 hover:bg-rose-600/30"
                : "bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed"}`}>
            <Trash2 size={14}/> Clean Dust
          </button>

          {/* Delete flow */}
          {!deleteMode && (
            /* STEP 1: Enter delete mode */
            <button
              onClick={() => setDeleteMode(true)}
              className="inline-flex items-center gap-1 rounded-md bg-red-600/20 px-3 py-1 text-sm text-red-300 border border-red-600 hover:bg-red-600/30 transition">
              <Trash2 size={14}/> Delete
            </button>
          )}

          {deleteMode && (
            <>
              {/* helper text */}
              <span className="text-xs text-zinc-400 italic mr-2">
                {selected.size === 0
                  ? "Select row(s) to delete"
                  : `${selected.size} selected`}
              </span>

              {/* STEP 2a: Confirm */}
              <button
                disabled={selected.size === 0}
                onClick={async () => {
                  try {
                    // grouped is { walletId: ['mint1','mint2', …] }
                    for (const [wid, mints] of Object.entries(grouped)) {
                      await deleteOpenTrades(mints, false, wid);     // 👈 send wid
                    }
                    toast.success(`Deleted ${selected.size} row(s).`);
                    exitDeleteMode();
                    refresh();
                  } catch (err) { toast.error(err.message); }
                }}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm border transition
                  ${selected.size
                    ? "bg-red-600/20 text-red-300 border-red-600 hover:bg-red-600/30"
                    : "bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed"}`}>
                <Trash2 size={14}/> Confirm
              </button>

              {/* STEP 2b: Cancel */}
              <button
                onClick={exitDeleteMode}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-sm text-zinc-300 border border-zinc-600 hover:bg-zinc-700 transition">
                <XCircle size={14}/> Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {/* filter pills */}
      <nav className="flex flex-wrap gap-2">
        {["All", ...STRATS].map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === k
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}>
            {k}
          </button>
        ))}
      </nav>

      {/* tabs */}
      <div className="flex gap-2">
        {["positions","pending"].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
              tab === t
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}>
            {t === "positions" ? "Open Positions" : "Pending Orders"}
          </button>
        ))}
      </div>

      {tab === "pending" && <PendingOrdersTab />}

      {tab === "positions" && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-center">
            <thead className="sticky top-0 z-10 backdrop-blur-md">
              <tr className="bg-zinc-800/90 text-zinc-200">
                <th className="p-3 text-left">Token</th>
                <th className="p-3">Entry / Cur.</th>
                <th className="p-3">PnL</th>
                <th className="p-3">Spent → Value</th>
                <th className="p-3">Strategy</th>
                {/* 🆕 Exit rule (smart-exit badge) */}
                <th className="p-3">Exit Rule</th>
                {/* {showTpSl && <th className="p-3">TP / SL</th>} */}
                <th className="p-3">TP / SL</th>
                <th className="p-3">Sell</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-800">
              {loading && (
                <tr>
                  <td colSpan={columnCount} className="p-6">
                    <div className="flex items-center justify-center gap-2 text-zinc-400">
                      <Loader2 className="animate-spin" size={16}/> Loading…
                    </div>
                  </td>
                </tr>
              )}

              {!loading && !visible.length && (
                <tr>
                  <td colSpan={columnCount} className="p-6 text-center italic text-zinc-500">
                    No open positions.
                  </td>
                </tr>
              )}

              {!loading && merged.map(r => {
                const gain = r.pnlPct >= 0;
                const heavy = Math.abs(r.pnlPct) >= 20;

                // 🔥 THIS MUST BE INSIDE MAP TO ACCESS r
                const rulesForThisRow = tpSlRules.filter(
                  rule => rule.mint === r.mint &&
                          rule.walletId === r.walletId &&
                          rule.strategy === r.strategy
                );
                console.log("🖼️ Token logo:", r.name, r.mint, "→", r.logo);

                return (
                  <tr
                    key={`${r.mint}_${r.strategy}`}
                    onClick={() => deleteMode && toggleRow(`${r.mint}_${r.strategy}`)}
                    className={`transition select-none
                      ${deleteMode ? "cursor-pointer" : ""}
                      ${selected.has(`${r.mint}_${r.strategy}`) && deleteMode
                        ? "ring-2 ring-red-500/70 bg-red-500/5"
                        : "hover:bg-zinc-800/30 hover:ring-1 hover:ring-emerald-500/30"}`}
                  >

                    {/* token */}
                    <td className="py-2 px-3 text-left align-top">
                      <div className="flex flex-col text-xs text-left">
                        {/* Top row: logo + name */}
                        <div className="flex items-center gap-2 font-medium text-white">
                          {!!r.logo && (
                            <img
                              src={r.logo}
                              alt="token"
                              className="w-7 h-7 rounded-full"
                              onError={(e) => {
                                console.log("❌ Image load failed for:", r.logo);
                                e.target.onerror = null;
                                e.target.remove();
                              }}
                            />
                          )}
                          {r.name || "Unknown"} {r.symbol ? `(${r.symbol})` : ""}
                          {r.entryUSD === null && (
                            <span className="ml-1 mt-1 text-amber-400 text-[10px]">Imported</span>
                          )}
                        </div>

                        {/* Bottom row: mint + link, spaced lower */}
                        <div className="flex items-center gap-1 text-zinc-400 mt-3">
                          <span>{shortAddress(r.mint)}</span>
                          <a
                            href={`https://birdeye.so/token/${r.mint}?chain=solana`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-white transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5 inline" />
                          </a>
                        </div>
                      </div>
                    </td>

                    {/* entry / current */}
                    <td className="py-2 px-3">
                      <div>{r.entryUSD === null ? "N/A" : `$${r.entryUSD.toFixed(6)}`}</div>
                      <div className="text-zinc-400">${r.priceUSD.toFixed(6)}</div>
                    </td>

                    {/* PnL */}
                    <td className="py-2 px-3">
                      <span
                        className={pill(
                          gain ? emerald : red
                        ) + ` inline-flex items-center gap-0.5 ${heavy && "animate-pulse"}`}>
                        {gain ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                        {Math.abs(r.pnlPct).toFixed(2)}%
                      </span>
                      <div className="text-zinc-400 text-[10px]">${r.pnlUSD.toFixed(2)}</div>
                    </td>

                    {/* spent / value */}
                    <td className="py-2 px-3">
                      {/* If no cost basis (imported), show “N/A” instead of $0 */}
                      {r.entryUSD === null
                        ? "N/A"
                        : `$${r.spentUSD.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`}
                      <span className="text-zinc-400"> → </span>
                      ${r.valueUSD.toFixed(2)}
                    </td>

                    {/* strategy */}
                    <td className="py-2 px-3">
                      <span className={`${emerald} inline-flex items-center gap-1`}>
                        <DollarSign size={10}/> {r.strategy === "unknown" ? "N/A" : r.strategy}
                      </span>
                    </td>

                    {/* 🆕 Exit Rule (Smart-Exit badge) */}
                    <td className="py-2 px-3">
                      <SmartBadge trade={r} />
                    </td>

                    {/* TP / SL */}
                    <td className="py-2 px-3">
                      <TpSlCell
                        mint={r.mint}
                        strategy={r.strategy}
                        walletId={r.walletId}
                        walletLabel={r.walletLabel}
                        rules={rulesForThisRow}
                        onSaved={refresh}
                      />
                    </td>

                    {/* sell */}
                    <td className="py-2 px-3">
                      <div className="flex gap-1 mb-1">
                        <button
                          onClick={() => sell(r.mint, r.strategy, 0.5, r.walletLabel, r.walletId)}
                          className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200 border border-amber-500 hover:bg-amber-500/30">
                          50%
                        </button>
                        <button
                          onClick={() => sell(r.mint, r.strategy, 1, r.walletLabel, r.walletId)}
                          className="rounded bg-rose-600/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300 border border-rose-600 hover:bg-rose-600/30">
                          100%
                        </button>
                      </div>

                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={customSell?.[`${r.mint}_${r.strategy}`] ?? ""}
                          onChange={(e) =>
                            setCustomSell((p) => ({ ...p, [`${r.mint}_${r.strategy}`]: e.target.value }))
                          }
                          placeholder="%"
                          className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-xs text-white text-center"
                        />
                        <button
                          onClick={() => {
                            const raw = parseFloat(customSell?.[`${r.mint}_${r.strategy}`]);
                            if (isNaN(raw) || raw <= 0 || raw >= 100) {
                              toast.error("Enter % between 1-99");
                              return;
                            }
                            sell(r.mint, r.strategy, raw / 100, r.walletLabel, r.walletId);
                            setCustomSell((p) => ({ ...p, [`${r.mint}_${r.strategy}`]: "" }));
                          }}
                          className="rounded bg-blue-600/20 px-2 py-0.5 text-[11px] font-semibold text-blue-300 border border-blue-600 hover:bg-blue-600/30">
                          Sell %
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "positions" && visible.length > 0 && (
        <footer className="flex justify-end border-t border-zinc-800 pt-4 text-xs text-zinc-400">
          <span className="mr-4">Total trades: <strong>{visible.length}</strong></span>
          <span>Total exposure: <strong>${totalUsd}</strong></span>
        </footer>
      )}
    </div>
  );
}
