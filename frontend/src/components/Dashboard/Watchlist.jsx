// Watchlist.jsx – v2.2.1 (layout + 24h Δ fix)

import React, { useEffect, useState } from "react";
import {
  Plus, Crosshair, RefreshCcw, Trash2, ShieldCheck, ShieldX, Star, Info,
} from "lucide-react";
import { toast }             from "sonner";
import { manualSnipe,
         checkTokenSafety,
         getTokenMarketStatsPaid } from "@/utils/api";
import TopHolderBreakdown     from "./Watchlist/TopHolderBreakdown";
import MarketStats            from "./Watchlist/MarketStats";

const WATCHLIST_KEY = "sniper_watchlist";

/* ----------------------------- UI helpers ----------------------------- */
const colourForScore = (s) => {
  if (s === 100) return "bg-emerald-600/20 text-emerald-300 border-emerald-500";
  if (s >= 88)   return "bg-lime-600/20    text-lime-300    border-lime-500";
  if (s >= 77)   return "bg-lime-500/20    text-lime-300    border-lime-400";
  if (s >= 66)   return "bg-yellow-600/20  text-yellow-300  border-yellow-500";
  if (s >= 55)   return "bg-amber-600/20   text-amber-300   border-amber-500";
  if (s >= 44)   return "bg-orange-600/20  text-orange-300  border-orange-500";
  if (s >= 33)   return "bg-rose-600/20    text-rose-300    border-rose-500";
  if (s >= 22)   return "bg-red-600/20     text-red-300     border-red-500";
  return            "bg-red-800/20      text-red-300      border-red-700";
};

const tierColorMap = {
  T1: { label: "Healthy (<20%)", class: "bg-cyan-600/20 text-cyan-300 border-cyan-500", description: "Low whale concentration (<20%)" },
  T2: { label: "Watch (20–40%)", class: "bg-yellow-600/20 text-yellow-300 border-yellow-500", description: "Moderate whale presence (20–40%)" },
  T3: { label: "High (40–60%)", class: "bg-orange-600/20 text-orange-300 border-orange-500", description: "High concentration risk (40–60%)" },
  T4: { label: "Dominant (>60)", class: "bg-rose-600/20 text-rose-300 border-rose-500", description: "Top whales hold >60% of supply" },
};

const compactUsd = (n) =>
  n != null
    ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)
    : "—";

/** Normalize % values:  -10  or  -0.10  ➜  -10.00 */
const formatPct = (val) => {
  if (val == null || isNaN(val)) return null;
  const p = Math.abs(val) <= 1 ? val * 100 : val;
  return Number.isFinite(p) ? p : null;
};

/* ------------------------------ Badges -------------------------------- */
const basePill =
  "inline-flex items-center whitespace-nowrap shrink-0 rounded-full border px-2 py-1 text-xs font-semibold leading-none";

const TierBadge = ({ tier, top5Pct }) => {
  let short = null;
  if (tier?.startsWith("T")) short = tier.slice(0, 2);
  else if (tier?.includes("Healthy")) short = "T1";
  else if (tier?.includes("Watch") || tier?.includes("Alert")) short = "T2";
  else if (tier?.includes("High")) short = "T3";
  else if (tier?.includes("Dominant")) short = "T4";

  if (!short && typeof top5Pct === "number") {
    if (top5Pct < 20) short = "T1";
    else if (top5Pct < 40) short = "T2";
    else if (top5Pct < 60) short = "T3";
    else                  short = "T4";
  }

  const t = tierColorMap[short];
  if (!t) return null;

  return (
    <span className={`${basePill} ${t.class}`} title={`Tier ${short}: ${t.description}`}>
      {t.label}
    </span>
  );
};

const Top5Badge = ({ pct }) => {
  let cls = "bg-emerald-600/20 text-emerald-300 border-emerald-500";
  if (pct > 60) cls = "bg-rose-600/20 text-rose-300 border-rose-500";
  else if (pct > 40) cls = "bg-orange-600/20 text-orange-300 border-orange-500";
  else if (pct > 20) cls = "bg-yellow-600/20 text-yellow-300 border-yellow-500";

  return (
    <span className={`${basePill} ${cls}`} title={`Top 5 holders control ${pct.toFixed(2)}%`}>
      {pct.toFixed(2)}%
    </span>
  );
};

const StatBadge = ({ val, title }) => (
  <span className={`${basePill} border-zinc-600 bg-zinc-700/30 text-zinc-200`} title={title}>
    {val}
  </span>
);

const TierLinkedStat = ({ val, title, tier }) => {
  const short = tier?.replace(/ .*/, "");
  const t = tierColorMap[short];
  const color = t?.class || "bg-zinc-700 text-zinc-200 border-zinc-600";
  return (
    <span className={`${basePill} ${color}`} title={title}>
      {val}
    </span>
  );
};

const ChangeBadge = ({ pct }) => {
  const norm = formatPct(pct);
  if (norm == null) return <StatBadge val="—" title="No data" />;
  const up = norm >= 0;
  return (
    <span
      className={`${basePill} ${up
        ? "bg-emerald-600/20 text-emerald-300 border-emerald-500"
        : "bg-rose-600/20 text-rose-300 border-rose-500"}`}
      title="24 h price change"
    >
      {up ? "▲" : "▼"} {Math.abs(norm).toFixed(2)}%
    </span>
  );
};

/* --------------------------- Derived checks --------------------------- */
const buildExpandedChecks = (safety = {}) => {
  if (!safety || typeof safety !== "object") return [];
  const tags = [];
  if (safety.authority?.detail) {
    const { mint, freeze } = safety.authority.detail;
    tags.push({
      label : "Mint Authority OK",
      passed: mint?.authority === null,
      reason: mint?.authority ? "Mint authority still exists" : undefined,
    });
    tags.push({
      label : "Freeze Authority Removed",
      passed: freeze?.authority === null,
      reason: freeze?.authority ? "Freeze authority still exists" : undefined,
    });
    tags.push({
      label : "Owner Renounced",
      passed: mint?.authority === null && freeze?.authority === null,
    });
  }
  if (safety.verified) {
    tags.push({
      label : "Verified Contract",
      passed: safety.verified.passed,
      reason: safety.verified.reason,
    });
  }
  safety.__derived = tags;
  return tags;
};

const extractChecks = (safety) => [
  ...(Object.values(safety || {})
    .filter((v) => v && typeof v === "object" && "passed" in v && v.key !== "authority")),
  ...(safety?.__derived || []),
];

/* ================================ Main ================================ */
export default function Watchlist() {
  const [tokens, setTokens] = useState([]);
  const [filter, setFilter] = useState("all");
  const [newMint, setNewMint] = useState("");
  const [checkingMint, setCheckingMint] = useState(null);
  const [expandedMint, setExpandedMint] = useState(null);
  const [whaleFilter, setWhaleFilter] = useState(false);

  const persist = (list) => {
    setTokens(list);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  };

  const safetyScore = (token) => {
    const checks = extractChecks(token.safety);
    if (checks.length === 0) return null;
    return Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  };

  const SafetyBadge = ({ score }) => {
    const cls = `${basePill} ${colourForScore(score)}`;
    return (
      <span className={cls} title={`Safety Score: ${score}%`}>
        {score >= 77 ? <ShieldCheck size={12} className="inline" /> : <ShieldX size={12} className="inline" />} {score}%
      </span>
    );
  };

  /* ------------------------------ CRUD ------------------------------- */
  const handleAddMint = async () => {
    const mint = newMint.trim();
    if (!mint) return;
    if (tokens.some((t) => t.mint === mint)) return toast("Already on Watchlist.");

    toast.loading("Checking safety…");
    const safety = await checkTokenSafety(mint);
    toast.dismiss();
    if (!safety) return toast.error("Safety check failed.");

    toast.loading("Fetching market data…");
    const market = await getTokenMarketStatsPaid(mint).catch(() => null);
    toast.dismiss();

    const entry = {
      mint,
      name: safety.verified?.data?.name || null,
      symbol: safety.verified?.data?.symbol || null,
      logoURI: safety.verified?.data?.logoURI || null,
      addedAt: new Date().toISOString(),
      safety,
      safetyScore: safetyScore({ safety }),
      market,
    };
    persist([...tokens, entry]);
    setNewMint("");
    toast.success("Added to Watchlist");
  };

  const handleRemove = (mint) => {
    persist(tokens.filter((t) => t.mint !== mint));
    toast.success("Removed");
  };

  const handleSnipe = async (mint) => {
    toast.loading("Sending snipe…");
    await manualSnipe(mint)
      .then(() => toast.success("Order sent"))
      .catch(() => toast.error("Snipe failed"))
      .finally(() => toast.dismiss());
  };

  const handleSafetyCheck = async (mint) => {
    setCheckingMint(mint);
    toast.loading("Re-checking safety…");
    const safety = await checkTokenSafety(mint);
    toast.dismiss();
    if (!safety) {
      setCheckingMint(null);
      return toast.error("Check failed.");
    }
    toast.loading("Refreshing market data…");
    const market = await getTokenMarketStatsPaid(mint).catch(() => null);
    toast.dismiss();

    persist(
      tokens.map((t) =>
        t.mint === mint
          ? {
              ...t,
              safety,
              name: safety.verified?.data?.name || t.name,
              symbol: safety.verified?.data?.symbol || t.symbol,
              logoURI: safety.verified?.data?.logoURI || t.logoURI,
              safetyScore: safetyScore({ safety }),
              market,
            }
          : t,
      ),
    );
    setCheckingMint(null);
    toast.success("Updated");
  };

  /* ----------------------------- Filters ----------------------------- */
  const filtered = tokens
    .filter((t) => {
      if (filter === "safe") return t.safety?.passed;
      if (filter === "unsafe") return t.safety && !t.safety.passed;
      return true;
    })
    .filter((t) => {
      if (!whaleFilter) return true;
      const pct = t.safety?.topHolders?.data?.top5Pct ?? 100;
      return pct < 30;
    })
    .sort((a, b) => (b.safetyScore ?? 0) - (a.safetyScore ?? 0));

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || [];
    setTokens(saved);
  }, []);

  /* ------------------------------ Render ----------------------------- */
  return (
    <section
      className="w-full max-w-none space-y-4 rounded-xl border border-zinc-700
                 bg-zinc-900 p-8 shadow-lg"
    >
      <header className="flex items-center gap-2 text-xl font-semibold text-white">
        <ShieldCheck size={20} className="text-emerald-400" /> Safety Checker
      </header>

      {/* Add mint */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Paste token mint…"
            value={newMint}
            onChange={(e) => setNewMint(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-10 pr-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
          />
          <Star size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        </div>
        <button
          onClick={handleAddMint}
          className="flex items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-900 shadow hover:bg-amber-400 hover:shadow-amber-500/40"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "all", label: "All" },
          { key: "safe", label: "Safe" },
          { key: "unsafe", label: "Unsafe" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-[2px] text-xs font-semibold transition-colors ${
              filter === key ? "bg-emerald-600/20 text-emerald-300" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setWhaleFilter((p) => !p)}
          className={`rounded-full px-3 py-[2px] text-xs font-semibold transition-colors ${
            whaleFilter ? "bg-emerald-600/20 text-emerald-300" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          🐳 &lt; 30%
        </button>
      </div>

      {/* table */}
      {filtered.length === 0 ? (
        <p className="text-zinc-400">No tokens in this category.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto text-xs leading-tight">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-400">
                <th className="py-1 pl-4 pr-2 text-left">Token</th>
                <th className="py-1 px-2">Top Holder</th>
                <th className="py-1 px-2">Top 5 %</th>
                <th className="py-1 px-2">Score</th>
                <th className="py-1 px-2">Price</th>
                <th className="py-1 px-2">Liq.</th>
                <th className="py-1 px-2">24 h Δ</th>
                <th className="py-1 px-2">Vol 24h</th>
                <th className="py-1 px-2">MCap/FDV</th>
                <th className="py-1 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <React.Fragment key={t.mint}>
                  {/* main row */}
                  <tr className="group border-b border-zinc-800 hover:bg-zinc-800/30">
                    {/* Token */}
                    <td
                      onClick={() => {
                        navigator.clipboard.writeText(t.mint);
                        toast.success("Mint copied");
                        setExpandedMint(expandedMint === t.mint ? null : t.mint);
                      }}
                      className="cursor-pointer py-2 pl-3 pr-2 text-left font-medium text-emerald-300"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        {t.logoURI && <img src={t.logoURI} alt="logo" className="h-4 w-4 rounded-full" />}
                        <span className="whitespace-nowrap">
                          {t.symbol || t.name || `${t.mint.slice(0, 6)}…${t.mint.slice(-4)}`}
                        </span>
                        <span className="ml-1 text-zinc-500">{expandedMint === t.mint ? "▲" : "▼"}</span>
                      </div>
                    </td>

                    {/* Tier */}
                    <td className="py-2 px-2 text-center">
                      <TierBadge tier={t.safety?.topHolders?.data?.tier} top5Pct={t.safety?.topHolders?.data?.top5Pct} />
                    </td>

                    {/* Top 5% */}
                    <td className="py-2 px-2 text-center">
                      {t.safety?.topHolders?.data?.top5Pct !== undefined && (
                        <Top5Badge pct={t.safety.topHolders.data.top5Pct} />
                      )}
                    </td>

                    {/* Score */}
                    <td className="py-2 px-2 text-center">{t.safetyScore !== undefined && <SafetyBadge score={t.safetyScore} />}</td>

                    {/* Price */}
                    <td className="py-2 px-2 text-center">
                      {t.market ? (
                        <TierLinkedStat
                          val={`$${t.market.price.toFixed(4)}`}
                          title="Current price"
                          tier={t.safety?.topHolders?.data?.tier}
                        />
                      ) : (
                        <StatBadge val="—" title="No data" />
                      )}
                    </td>

                    {/* Liquidity */}
                    <td className="py-2 px-2 text-center">
                      {t.market ? (
                        <TierLinkedStat
                          val={`$${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(
                            t.market.liquidity,
                          )}`}
                          title="DEX liquidity"
                          tier={t.safety?.topHolders?.data?.tier}
                        />
                      ) : (
                        <StatBadge val="—" title="No data" />
                      )}
                    </td>

                    {/* 24 h Δ */}
                    <td className="w-[80px] py-2 px-2 text-center">
                      {t.market ? <ChangeBadge pct={t.market.change24h} /> : <StatBadge val="—" title="No data" />}
                    </td>

                    {/* Vol 24h */}
                    <td className="w-[100px] py-2 px-2 text-center">
                      {t.market ? (
                        <TierLinkedStat
                          val={`$${compactUsd(t.market.volume24hUSD)}`}
                          title="Volume (24h USD)"
                          tier={t.safety?.topHolders?.data?.tier}
                        />
                      ) : (
                        <StatBadge val="—" title="No data" />
                      )}
                    </td>

                    {/* MCap / FDV */}
                    <td className="py-2 px-2 text-center">
                      {t.market && t.market.marketCap && t.market.fdv ? (
                        <TierLinkedStat
                          val={`$${compactUsd(t.market.marketCap)}/$${compactUsd(t.market.fdv)}`}
                          title="Market Cap / FDV"
                          tier={t.safety?.topHolders?.data?.tier}
                        />
                      ) : (
                        <StatBadge val="—" title="No data" />
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2 px-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button title="Manual snipe" onClick={() => handleSnipe(t.mint)} className="text-emerald-400 hover:text-emerald-600">
                          <Crosshair size={16} />
                        </button>
                        <button
                          title="Re-check safety"
                          onClick={() => handleSafetyCheck(t.mint)}
                          disabled={checkingMint === t.mint}
                          className={`text-yellow-400 hover:text-yellow-600 ${checkingMint === t.mint && "animate-spin text-yellow-400"}`}
                        >
                          <RefreshCcw size={16} />
                        </button>
                        <button title="Remove" onClick={() => handleRemove(t.mint)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* expanded row (now spans full width) */}
                  {expandedMint === t.mint && (
                    <tr>
                      <td colSpan={10} className="bg-zinc-950 p-4">
                        <div className="flex flex-wrap justify-between gap-4">
                          {/* Safety Breakdown */}
                          <div className="min-w-[250px] max-w-[320px] flex-1">
                            <h4 className="mb-2 text-sm font-semibold text-white">Safety Breakdown</h4>
                            <ul className="space-y-1">
                              {[
                                ...buildExpandedChecks(t.safety),
                                ...Object.values(t.safety || {}).filter(
                                  (v) => v && typeof v === "object" && v.key !== "authority" && v.label !== "Verified Contract",
                                ),
                              ]
                                .filter((val) => typeof val.label === "string" && typeof val.passed === "boolean")
                                .map((val, idx) => (
                                  <li key={val.label + idx} className="flex items-center gap-2 text-xs text-white">
                                    {val.passed ? <ShieldCheck size={14} className="text-emerald-400" /> : <ShieldX size={14} className="text-red-400" />}
                                    <span className="font-medium">{val.label}</span>
                                    {!val.passed && val.reason && (
                                      <>
                                        <Info size={12} className="text-zinc-500" />
                                        <span className="text-zinc-400" title={val.reason}>
                                          {val.reason}
                                        </span>
                                      </>
                                    )}
                                  </li>
                                ))}
                            </ul>
                          </div>

                          {/* Whale Breakdown */}
                          <div className="min-w-[220px] max-w-[280px] flex-1">
                            <TopHolderBreakdown data={t.safety?.topHolders?.data} holders={t.market?.holders} />
                          </div>

                          {/* Market Stats */}
                          <div className="min-w-[220px] max-w-[280px] flex-1">{t.market ? <MarketStats data={t.market} /> : null}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
