// MarketStats.jsx
import React from "react";

const formatCompact = (n) =>
  typeof n === "number"
    ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)
    : n;


export default function MarketStats({ data }) {
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
        Market Stats
      </h5>

    <Row
      label="Price"
      value={typeof data.price === "number" ? `$${data.price.toFixed(4)}` : "—"}
      title="Latest market price"
    />
    <Row label="Liquidity" value={`$${formatCompact(data.liquidity)}`} title="Available liquidity on Solana DEXes" />
    <Row label="24h Δ" value={`${data.change24h.toFixed(2)}%`} title="24 hour price change" />
      <Row
        label="Volume (24h)"
        value={`$${formatCompact(data.volume24hUSD ?? data.volume24h)}`}
        title="24‑hour trading volume (USD)"
      />
      {data.uniqueWallet24h != null && (
  <Row
    label="Wallets (24h)"
    value={formatCompact(data.uniqueWallet24h)}
    title="Unique wallets active in the last 24 h"
  />
)}

      {/* <Row label="Token Age"     value={`${data.ageDays} days`} /> */}
    </div>
  );
}
