// pages/Dashboard/OpenTrades/PendingOrdersTab.jsx
// July 2025 — emerald-glow refresh ✨
//
// • Tailwind-only (delete styles/components/PendingOrdersTab.css)
// • Skeleton row, 60-sec poll, hide-finished toggle unchanged
// • Badges / buttons use the same emerald / rose / amber palette
// • Row hover → subtle ring + inner shadow (like OpenTradesTab)

import React, { useEffect, useState } from "react";
import { toast } from "sonner"; 
import {
  fetchPendingOrders,
  cancelOrder,
} from "@/utils/api";
import {
  fetchCurrentPrice,
  getPositions,
} from "@/utils/trades_positions";
import { formatLocalTimestamp } from "@/utils/timeFormatter";
import {
  RefreshCcw,
  Loader2,
  CheckCircle2,
  Clock4,
  XCircle,
  Trash2,
} from "lucide-react";

/* tiny badge helper ------------------------------------------ */
const pill = (cls = "") =>
  `inline-flex items-center gap-1 px-2 py-[1px] rounded-full text-[10px] font-medium border ${cls}`;
const emerald = pill("bg-emerald-600/20 text-emerald-300 border-emerald-500");
const rose    = pill("bg-rose-600/20    text-rose-300    border-rose-500");
const amber   = pill("bg-amber-500/30   text-amber-300   border-amber-500");

export default function PendingOrdersTab() {
  /* ───── state ───── */
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [hideFinished, setHide] = useState(false);
  const [prices, setPrices]     = useState({});
  const [positions, setPositions] = useState([]);

  /* ───── helpers ───── */
  const tokenName = (mint) =>
    positions.find((p) => p.mint === mint)?.name || `${mint.slice(0,4)}…${mint.slice(-4)}`;

  const refresh = async (toastMsg = true) => {
    setLoading(true);
    try {
      const [orders, posSnap] = await Promise.all([
        fetchPendingOrders(),
        getPositions(),
      ]);
      setPositions(posSnap.positions || []);
      setRows(orders.filter((o) => o.status !== "deleted"));
      toastMsg && toast.success("Refreshed");
    } finally { setLoading(false); }
  };

  /* first load + 60 s poll */
  useEffect(() => {
    refresh(false);
    const id = setInterval(() => refresh(false), 60_000);
    return () => clearInterval(id);
  }, []);

  /* live price map (only visible mints) */
  useEffect(() => {
    const load = async () => {
      if (!rows.length) return;
      const uniq = [...new Set(rows.map((r) => r.mint))];
      const pairs = await Promise.all(uniq.map(async (m) => [m, await fetchCurrentPrice(m)]));
      setPrices(Object.fromEntries(pairs));
    };
    load();
  }, [rows]);

  /* ───── render ───── */
  const filteredRows = rows
    .filter((o) => {
      if (!hideFinished) return true;
      const done = (o.type === "dca" && (o.executedCount ?? 0) >= (o.numBuys ?? Infinity))
                || o.status === "done";
      return !done;
    })
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  const columns = 6;

  return (
    <div className="space-y-6">
      {/* header */}
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-200 drop-shadow-[0_0_6px_rgba(99,102,241,0.65)]">
          Pending Orders
        </h2>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setHide(!hideFinished)}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
              hideFinished
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}>
            {hideFinished ? "Show Finished" : "Hide Finished"}
          </button>

          <button
            onClick={() => refresh()}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 ring-1 ring-zinc-700 hover:ring-indigo-500/40 transition">
            <RefreshCcw size={14}/> Refresh
          </button>
        </div>
      </header>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-center">
          <thead className="bg-zinc-800/90 text-zinc-200">
            <tr>
              <th className="p-3">Type</th>
              <th className="p-3 text-left">Token</th>
              <th className="p-3">Current&nbsp;($)</th>
              <th className="p-3 text-left">Details</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800">
            {/* skeleton */}
            {loading && (
              <tr>
                <td colSpan={columns} className="p-6">
                  <div className="flex items-center justify-center gap-2 text-zinc-400">
                    <Loader2 className="animate-spin" size={16}/> Loading orders…
                  </div>
                </td>
              </tr>
            )}

            {!loading && !filteredRows.length && (
              <tr>
                <td colSpan={columns} className="p-6 italic text-zinc-500">
                  No pending orders.
                </td>
              </tr>
            )}

            {!loading && filteredRows.map((o) => {
            const dcaDone = o.type === "dca" && (o.executedCount ?? 0) >= (o.numBuys ?? Infinity) || o.status === "filled";
            const limitDone = o.type === "limit" && o.status === "executed";
            const done = dcaDone || limitDone || o.status === "done";

              /* status badge */
              const statusBadge = done
                ? <span className={emerald}><CheckCircle2 size={10}/> Complete</span>
                : o.status === "deleted"
                  ? <span className={rose}><XCircle size={10}/> Canceled</span>
                  : <span className={amber}><Clock4 size={10}/> In&nbsp;Progress</span>;

              /* details string */
const details = o.type === "limit"
  ? <>
      {`${o.side} ≤ $${o.targetPrice ?? o.price} • $${o.amount} USDC`}
      {o.tx && (
        <div className="text-[10px] mt-0.5">
          <a
            href={`https://explorer.solana.com/tx/${o.tx}?cluster=mainnet-beta`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            View Tx ↗
          </a>
        </div>
      )}
    </>
  : (() => {
      const unit = (o.unit || "").toUpperCase();
      const every = o.freqHours === 1 ? "hour" : `${o.freqHours} h`;
      const doneCnt = o.executedCount ?? 0;
      const total = o.numBuys ?? "∞";
      const chunk = total === "∞"
        ? (o.amount / 1).toFixed(2)
        : (o.amount / total).toFixed(2);
      const hi = o.stopAbove ? ` • stop ≥ $${o.stopAbove}` : "";
      const lo = o.stopBelow ? ` • stop ≤ $${o.stopBelow}` : "";
      return <>
        {`${chunk} ${unit} every ${every} • ${doneCnt}/${total} buys${hi}${lo}`}
        {o.tx && (
          <div className="text-[10px] mt-0.5">
            <a
              href={`https://explorer.solana.com/tx/${o.tx}?cluster=mainnet-beta`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              View Tx ↗
            </a>
          </div>
        )}
      </>
    })();

              const actionLabel = done ? "Delete" : "Cancel";
              const handleAction = () =>
                cancelOrder(o.id).then(() => {
                  toast.success(done ? "Deleted" : "Canceled");
                  setRows(cur => cur.filter(r => r.id !== o.id));
                });

              return (
                <tr key={o.id}
                    className="hover:bg-zinc-800/30 hover:ring-1 hover:ring-emerald-500/30 hover:shadow-inner hover:shadow-emerald-900/20 transition">
                  <td className="p-3">{o.type}</td>

                  <td className="p-3 text-left leading-tight" title={o.mint}>
                    <div className="font-medium">{tokenName(o.mint)}</div>
                    <div className="text-[10px] text-zinc-500">{formatLocalTimestamp(o.createdAt)}</div>
                  </td>

                  <td className="p-3">
                    {prices[o.mint] != null ? `$${prices[o.mint].toFixed(6)}` : <span className="text-zinc-400">—</span>}
                  </td>

                  <td className="p-3 text-left">{details}</td>

                  <td className="p-3">{statusBadge}</td>

                  <td className="p-3">
                    <button
                      onClick={handleAction}
                      className="inline-flex items-center gap-1 rounded bg-rose-600/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300 border border-rose-600 hover:bg-rose-600/30">
                      <Trash2 size={11}/> {actionLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
