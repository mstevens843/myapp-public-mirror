// TargetToken.jsx – v2.3  (persist market/safety • refresh • Birdeye/Dex links)
// ---------------------------------------------------------------------------
import React, { useState, useEffect } from "react";
import {
  Crosshair,
  ShieldCheck,
  ShieldX,
  PlusCircle,
  RefreshCcw,
  X as Close,
  Loader2,
} from "lucide-react";
import { toast } from "react-toastify";

import {
  checkTokenSafety,
  getPrefs,
  manualBuy,
  getTokenMarketStatsPaid,
} from "@/utils/api";
import { openConfirmModal } from "@/hooks/useConfirm";
import "@/styles/components/TokenSelector.css";

const WATCHLIST_KEY = "sniper_watchlist";
const STORAGE_KEY   = "targetToken";
const MARKET_KEY    = "targetTokenMarket";
const SAFETY_KEY    = "targetTokenSafety";

/* ───── helpers ──────────────────────────────────────────────────── */
const SIMPLE_KEYS = ["simulation", "authority", "liquidity", "topHolders", "verified"];
const LABEL_MAP = {
  simulation : "Honeypot Check",
  authority  : "Mint / Freeze Auth",
  liquidity  : "Liquidity",
  topHolders : "Whale Control",
  verified   : "Verified",
};
const isValidSolanaAddress = (addr) => /^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(addr);
const badgeColor = (p) => p
  ? "bg-emerald-600/20 text-emerald-300 border-emerald-500"
  : "bg-rose-600/20 text-rose-300 border-rose-500";

const scoreColor = (s) =>
  s === 100 ? "#16a34a" :
  s >= 88  ? "#22c55e" :
  s >= 77  ? "#84cc16" :
  s >= 66  ? "#eab308" :
  s >= 55  ? "#facc15" :
  s >= 44  ? "#f97316" :
  s >= 33  ? "#f43f5e" :
  s >= 22  ? "#dc2626" :
             "#7f1d1d";

const compactUsd = (n) =>
  n != null
    ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)
    : "—";

const ChangeBadge = ({ pct }) => (
  <span
    className={`px-2 py-[1px] rounded-full text-xs font-semibold border ${
      pct >= 0
        ? "bg-emerald-600/20 text-emerald-300 border-emerald-500"
        : "bg-rose-600/20 text-rose-300 border-rose-500"
    }`}
    title="24 h price change"
  >
    {pct >= 0 ? "▲" : "▼"} {(Math.abs(pct) * 100).toFixed(2)}%
  </span>
);

const StatBadge = ({ val, title }) => (
  <span
    className="px-2 py-[1px] rounded-full text-xs font-semibold border border-zinc-600 bg-zinc-700/30 text-zinc-200"
    title={title}
  >
    {val}
  </span>
);

/* ───── main component ──────────────────────────────────────────── */
export default function TargetToken({ onMintSelected }) {
  const [mint,   setMint]   = useState(localStorage.getItem(STORAGE_KEY) || "");
  const [safety, setSafety] = useState(
    JSON.parse(localStorage.getItem(SAFETY_KEY)) || null
  );
  const [market, setMarket] = useState(
    JSON.parse(localStorage.getItem(MARKET_KEY)) || null
  );
  const [checking,setChecking] = useState(false);
  const [glow,    setGlow]     = useState({ ok: false, fail: false });
  const [prefs,   setPrefs]    = useState(null);

  /* ---- fetch prefs once ---- */
  useEffect(() => { getPrefs("default").then(setPrefs).catch(() => setPrefs({})); }, []);

  const saveMarket = (m) => {
    setMarket(m);
    localStorage.setItem(MARKET_KEY, JSON.stringify(m));
  };
  const saveSafety = (s) => {
    setSafety(s);
    localStorage.setItem(SAFETY_KEY, JSON.stringify(s));
  };

  const getSafetyScore = (breakdown = {}) => {
    const vals    = Object.values(breakdown);
    const total   = vals.length;
    const passed  = vals.filter((v) => v?.passed).length;
    return total ? Math.round((passed / total) * 100) : null;
  };

  /* ---- maybe auto‑buy (unchanged) ---- */
  const maybeAutoBuy = async (mintAddr) => {
    if (!prefs?.autoBuy?.enabled) return;
    const amount   = prefs.autoBuy.amount || 0.05;
    const slippage = prefs.slippage ?? 1.0;

    const proceed = !prefs.confirmBeforeTrade
      ? true
      : await openConfirmModal(`Auto‑buy ${amount} SOL of this token?`);

    if (!proceed) return;

    const toastId = toast.loading(`🤖 Auto‑buying ${amount} SOL…`);
    try {
      await manualBuy(amount, mintAddr, { slippage, chatId: "default", force: true });
      toast.update(toastId, { render: "✅ Auto‑buy complete", type: "success", isLoading: false, autoClose: 5_000 });
    } catch (err) {
      toast.update(toastId, { render: `❌ Auto‑buy failed: ${err.message}`, type: "error", isLoading: false, autoClose: 7_000 });
    }
  };

  /* ───── handlers ─────────────────────────────────────────────── */
  const handleSetTarget = async (e) => {
    e.preventDefault();
    const trimmed = mint.trim();

    if (!isValidSolanaAddress(trimmed)) {
      toast.error("❌ Invalid token mint address.");
      return;
    }

    toast.loading("Fetching market data…");
    const mkt = await getTokenMarketStatsPaid(trimmed).catch(() => null);
    toast.dismiss();

    onMintSelected(trimmed);
    localStorage.setItem(STORAGE_KEY, trimmed);
    saveMarket(mkt);
    toast.success("🎯 Target token set!");

    await maybeAutoBuy(trimmed);

    setGlow({ ok: true, fail: false });
    setTimeout(() => setGlow({ ok: false, fail: false }), 2_500);
  };

  const handleSafety = async () => {
    if (!isValidSolanaAddress(mint)) {
      toast.error("Enter a valid mint address first.");
      return;
    }

    setChecking(true);
    try {
      const res  = await checkTokenSafety(mint.trim());
      saveSafety(res);

      const mkt  = await getTokenMarketStatsPaid(mint.trim()).catch(() => null);
      saveMarket(mkt);

      const simple = SIMPLE_KEYS.map((k) => res?.[k]?.passed);
      const safe   = simple.every(Boolean);
      setGlow({ ok: safe, fail: !safe });

      if (safe) toast.success("✅ Token passed safety checks!");
    } catch {
      toast.error("❌ Safety check failed.");
      saveSafety(null);
    } finally {
      setChecking(false);
      setTimeout(() => setGlow({ ok: false, fail: false }), 2_500);
    }
  };

  const handleRefresh = async () => {
    if (!isValidSolanaAddress(mint)) return;
    toast.loading("Refreshing market data…");
    const mkt = await getTokenMarketStatsPaid(mint.trim()).catch(() => null);
    toast.dismiss();
    saveMarket(mkt);
    toast.success("🔄 Data refreshed");
  };

  const handleWatchlist = () => {
    if (!isValidSolanaAddress(mint)) {
      toast.error("No valid token mint to add.");
      return;
    }

    const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || [];
    if (list.find((t) => t.mint === mint.trim())) {
      toast.info("Already in watchlist.");
      return;
    }

    list.push({
      mint: mint.trim(),
      addedAt: new Date().toISOString(),
      safety,
      safetyScore: safety?.breakdown ? getSafetyScore(safety.breakdown) : null,
      market,
    });
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    toast.success("⭐ Added to watchlist!");
  };

  const clearTarget = () => {
    [STORAGE_KEY, MARKET_KEY, SAFETY_KEY].forEach((k) => localStorage.removeItem(k));
    setMint("");
    setSafety(null);
    setMarket(null);
    toast.info("🎯 Target token cleared.");
  };

  /* ───── derived ui helpers ───────────────────────────────────── */
  const simpleChecks = SIMPLE_KEYS.map((key) => {
    const node = safety?.[key];
    let passed = !!node?.passed;
    let reason = node?.reason || node?.error || "No data";

    if (key === "topHolders") {
      const pct = node?.data?.top5Pct ?? 100;
      passed = pct < 30;
      reason  = `Top‑5 hold ${pct.toFixed(2)} %`;
    }
    return { key, passed, reason };
  });
  const uiPassed = simpleChecks.every((c) => c.passed);
  const uiScore  = Math.round((simpleChecks.filter((c) => c.passed).length / simpleChecks.length) * 100);

  /* ───── jsx ──────────────────────────────────────────────────── */
  return (
    <form onSubmit={handleSetTarget} className="space-y-0">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 mb-4 shadow-lg hover:shadow-purple-800/10 transition-shadow duration-300 space-y-3">

        {/* ───────────── Input Row ───────────── */}
{/* ───────────── Input Row ───────────── */}
<div className="flex flex-col sm:flex-row sm:items-center gap-3">
<div className="flex flex-1 items-center gap-2 min-w-0">
    <Crosshair size={16} className="text-emerald-400 shrink-0" />
    <input
      type="text"
      placeholder="Paste SOL mint"
      value={mint}
      onChange={(e) => setMint(e.target.value)}
      disabled={Boolean(localStorage.getItem(STORAGE_KEY))}
  className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500
    ${glow.ok ? "border-emerald-400 animate-pulse"
              : glow.fail ? "border-red-500 animate-pulse"
              : "border-zinc-600"}`}
    />
  </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="submit"
              disabled={Boolean(localStorage.getItem(STORAGE_KEY))}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-sm font-semibold text-white shadow-md hover:shadow-purple-800/40 disabled:opacity-50"
            >
              Set
            </button>

            <button
              type="button"
              onClick={handleSafety}
              disabled={checking || !isValidSolanaAddress(mint)}
              className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-blue-800/40 text-sm flex items-center gap-1 disabled:opacity-50"
            >
              {checking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {checking ? "Checking…" : "Safety"}
            </button>



            <button
              type="button"
              onClick={handleWatchlist}
              className="px-3 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-500 text-black shadow-md hover:shadow-yellow-600/40 text-sm flex items-center gap-1"
            >
              <PlusCircle size={14} /> Add to List
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={!isValidSolanaAddress(mint)}
              className="p-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white shadow-md hover:shadow-zinc-800/40 disabled:opacity-50"
              title="Refresh market data"
            >
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>

        {/* ───────── Header Row ───────── */}
        {localStorage.getItem(STORAGE_KEY) && (
          <div className="flex justify-end gap-3 text-[10px] uppercase tracking-wider text-zinc-400 px-2 pr-9">
            <span className="w-[80px]  text-center">Price</span>
            <span className="w-[90px]  text-center">Liquidity</span>
            <span className="w-[70px]  text-center">24h Δ</span>
            <span className="w-[100px] text-center">Vol 24h</span>
            <span className="w-[140px] text-center">MCap / FDV</span>
            <span className="w-[90px]  text-center">Holders</span>
            <span className="w-[100px] text-center">Wallets 24h</span>
          </div>
        )}

        {/* ───────── Current Target Row ───────── */}
        {localStorage.getItem(STORAGE_KEY) && (
          <div className="flex items-center justify-between gap-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white">
            <div className="flex items-center gap-2">
              <img
                src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${mint}/logo.png`}
                alt=""
                onError={(e) => { e.currentTarget.src = ""; }}
                className="w-4 h-4 rounded-full"
              />
              <span className="font-medium text-emerald-300">
                {market?.name?.length ? market.name : `${mint.slice(0,4)}…${mint.slice(-4)}`}
              </span>
            </div>

            <div className="ml-auto pr-1 overflow-x-auto whitespace-nowrap flex items-center gap-3">
              {market ? (
                <>
                  <div className="w-[80px] text-center">
                    <StatBadge val={market?.price != null ? `$${market.price.toFixed(4)}` : "—"} title="Current price" />
                  </div>
                  <div className="w-[90px] text-center">
                    <StatBadge val={market?.liquidity != null ? `$${compactUsd(market.liquidity)}` : "—"} title="DEX liquidity" />
                  </div>
                  <div className="w-[70px] text-center">
                    {market?.change24h != null ? <ChangeBadge pct={market.change24h} /> : <span className="text-zinc-400 text-xs italic">No Δ</span>}
                  </div>
                  <div className="w-[100px] text-center">
                    <StatBadge val={market?.volume24hUSD != null ? `$${compactUsd(market.volume24hUSD)}` : "—"} title="Volume (24h USD)" />
                  </div>
                  <StatBadge
                    val={market?.marketCap != null && market?.fdv != null ? (
                      <span className="text-[11px]">${compactUsd(market.marketCap)} / ${compactUsd(market.fdv)}</span>
                    ) : "—"}
                    title="Market Cap / FDV"
                  />
                  <div className="w-[75px] text-center">
                    <StatBadge val={market?.holders != null ? compactUsd(market.holders) : "—"} title="Total holders" />
                  </div>
                  <div className="w-[100px] text-center">
                    <StatBadge val={market?.uniqueWallet24h != null ? compactUsd(market.uniqueWallet24h) : "—"} title="Unique wallets (24h)" />
                  </div>
                </>
              ) : (
                <span className="text-zinc-400 text-xs italic">No market data</span>
              )}
            </div>

            <button onClick={clearTarget} className="text-red-400 hover:text-red-300">
              <Close size={16} />
            </button>
          </div>
        )}

        {/* ───────── Safety Verdict Row ───────── */}
        {safety && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-2 mt-1 mb-2 text-sm text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${uiPassed ? "text-emerald-400" : "text-red-400"}`}>
                  {uiPassed ? " Safe to trade" : "❌ Unsafe token"}
                </span>
                {uiScore !== null && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-[2px] rounded ${
                      uiPassed
                        ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500"
                        : "bg-rose-600/20 text-rose-300 border border-rose-500"
                    }`}
                  >
                    {uiPassed ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                    {uiScore}%
                  </span>
                )}
              </div>

              <ul className="flex flex-wrap gap-2">
                {simpleChecks.map(({ key, passed, reason }) => (
                  <li
                    key={key}
                    className={`flex items-center gap-[2px] rounded-full border px-2 py-[1px] text-xs font-medium ${badgeColor(passed)}`}
                    title={reason || LABEL_MAP[key]}
                  >
                    {passed ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                    {LABEL_MAP[key]}
                  </li>
                ))}
              </ul>
            </div>
            
          </div>
        )}
      </div>
                  {/* Birdeye link */}
<div className="flex items-center gap-2">
  <a
    href={`https://birdeye.so/token/${mint.trim()}`}
    target="_blank"
    rel="noopener noreferrer"
    className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white shadow-md hover:shadow-teal-800/40 text-sm"
  >
    Birdeye
  </a>

  <a
    href={`https://dexscreener.com/solana/${mint.trim()}`}
    target="_blank"
    rel="noopener noreferrer"
    className="px-3 py-2 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white shadow-md hover:shadow-zinc-800/40 text-sm"
  >
    Dexscreener
  </a>
</div>
    </form>
  );
}
