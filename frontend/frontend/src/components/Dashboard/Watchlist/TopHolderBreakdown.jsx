import React from "react";

// Optional: format large numbers like 1,000,000 → 1M
const formatCompact = (n) =>
  typeof n === "number"
    ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)
    : n;

export default function TopHolderBreakdown({ data, holders }) {
  if (!data) return null;

  const Row = ({ label, value, title }) => (
    <div
      className="flex justify-between py-0.5 text-xs border-b border-white/10 last:border-none"
      title={title || ""}
    >
      <div className="flex items-center gap-1 text-zinc-400">
        <span>{label}</span>
        {/* {title && <span className="text-zinc-500">🛈</span>} */}
      </div>
      <span className="font-medium text-zinc-100">{value}</span>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-zinc-900/60 p-3">
      <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/70">
        Whale Breakdown
      </h5>

      <Row label="Top 1 Holder"  value={`${data.topHolderPct}%`} title="Single largest wallet holding" />
      <Row label="Top 5 Holders" value={`${data.top5Pct}%`} title="Combined share of top 5 holders" />
      <Row label="Top 10 Holders" value={`${data.top10Pct}%`} title="Combined share of top 10 holders" />
      <Row label="Top 20 Holders" value={`${data.top20Pct}%`} title="Combined share of top 20 holders" />
      <Row
        label="Tier"
        title="Whale tier classification"
        value={
          <span
            className={`font-semibold ${
              data.tier?.includes("Dominant")
                ? "text-red-400"
                : data.tier?.includes("High")
                ? "text-orange-300"
                : data.tier?.includes("Alert")
                ? "text-yellow-300"
                : "text-emerald-300"
            }`}
          >
            {data.tier?.includes("Dominant") ? "🐳 " : ""}
            {data.tier}
          </span>
        }
      />
      <Row
        label="Total Supply"
        value={formatCompact(data.totalSupply)}
        title="Reported total token supply"
      />
      {holders != null && (
      <Row
        label="Total Holders"
        value={formatCompact(holders)}
        title="Distinct on‑chain wallets holding the token"
      />
    )}

    </div>
  );
}
