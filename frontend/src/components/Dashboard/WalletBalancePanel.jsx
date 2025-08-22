// frontend/components/WalletBalancePanel.jsx
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  DollarSign,
  TrendingUp,
  ClipboardList,
  Wallet as WalletIcon,
  ChevronDown,
  Check
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { manualBuy } from "../../utils/api";
import { getOpenTrades, fetchPricesBatch } from "../../utils/trades_positions";
import { getWalletNetworth } from "../../utils/api";

// Wallet APIs
import {
  loadWallet,
  fetchActiveWallet,
  setActiveWalletApi,
} from "@/utils/auth";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

export default function WalletBalancePanel({ onWalletSwitched }) {
  const [net, setNet] = useState(null);
  const [open, setOpen] = useState({ count: 0, value: 0 });
  const [loading, setLoading] = useState(false);

  const [showSwap, setShowSwap] = useState(false);
  const [direction, setDirection] = useState("solToUsdc");
  const [amount, setAmount] = useState("");
  const [swapping, setSwapping] = useState(false);

  // wallets + active wallet
  const [wallets, setWallets] = useState([]);
  const [activeWalletId, setActiveWalletId] = useState(null);
  const [switching, setSwitching] = useState(false);

  const STABLE_MINTS = new Set([
    USDC_MINT,
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
    "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
    "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT",
  ]);

  /* ---------------- Wallet bootstrap ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const ws = (await loadWallet()) || [];
        setWallets(ws);
        const id = (await fetchActiveWallet()) || (ws[0] && ws[0].id) || null;
        setActiveWalletId(id);
      } catch (e) {
        console.error("wallet bootstrap failed:", e);
      }
    })();
  }, []);

  /* ---------------- Balances / open trades ---------------- */
  const fetchNetAndOpen = async () => {
    setLoading(true);
    try {
      const [netRes, openRes] = await Promise.allSettled([
        getWalletNetworth(), // server may include extra spl/dust; we'll compute display sum ourselves
        getOpenTrades({ take: 100, skip: 0, walletId: activeWalletId }),
      ]);

      if (netRes.status === "fulfilled") {
        setNet(netRes.value);
      } else {
        console.error("❌ networth fetch failed:", netRes.reason);
        toast.error("Could not refresh net worth.");
      }

      if (openRes.status === "fulfilled") {
        const scoped = (openRes.value || []).filter(t => t.walletId === activeWalletId);
        const trades = scoped.filter((t) => !STABLE_MINTS.has(t.mint));

        const mints = [...new Set(trades.map(t => t.mint))];
        let priceMap = {};
        try { priceMap = await fetchPricesBatch(mints); } catch (_) {}

        let totalUSD = 0;
        for (const t of trades) {
          const usd = (typeof t.usdValue === "number")
            ? t.usdValue
            : (Number(priceMap[t.mint] || 0) * Number(t.outAmount ?? 0)) / 10 ** (t.decimals ?? 9);
          totalUSD += usd;
        }
        setOpen({ count: trades.length, value: +totalUSD.toFixed(2) });
      } else {
        console.warn("⚠️ open trades fetch failed:", openRes.reason);
        setOpen({ count: 0, value: 0 });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeWalletId != null) fetchNetAndOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletId]);

  /* ---------------- Wallet switch handler ---------------- */
  const handleSwitchWallet = async (id) => {
    if (id === activeWalletId) return;
    setSwitching(true);
    try {
      const res = await setActiveWalletApi(id);
      if (res?.activeWalletId === id) {
        setActiveWalletId(id);
        const label = wallets.find((w) => w.id === id)?.label || `Wallet ${id}`;
        toast.success(`Active wallet: ${label}`);
        window.dispatchEvent(new CustomEvent("user:activeWalletChanged", { detail: { walletId: id } }));
        // Notify parent with new pubkey
        let pk = wallets.find((w) => w.id === id)?.publicKey;
        if (!pk) {
          try {
            const ws = (await loadWallet()) || [];
            setWallets(ws);
            pk = ws.find((w) => w.id === id)?.publicKey;
          } catch {}
        }
        if (pk && typeof onWalletSwitched === "function") {
          onWalletSwitched(pk);
        }
      } else {
        toast.error("Failed to set active wallet.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to set active wallet.");
    } finally {
      setSwitching(false);
    }
  };

  /* ---------------- Swap helpers ---------------- */
  const sol = net?.tokenValues?.find((t) => t.name === "SOL") ?? {};
  const usdc = net?.tokenValues?.find((t) => t.mint === USDC_MINT) ?? {};

  // Compute Net Worth as SOL + USDC + Open (strictly what the UI shows)
  const computedNetUSD = (() => {
    const a = Number(sol?.valueUSD ?? 0);
    const b = Number(usdc?.valueUSD ?? 0);
    const c = Number(open?.value ?? 0);
    const sum = a + b + c;
    if (!isFinite(sum)) return "0.00";
    return sum.toFixed(2);
  })();

  const setMax = () => {
    if (direction === "usdcToSol") {
      if (!usdc.amount) return;
      const max = Math.floor(usdc.amount * 1e6 - 1) / 1e6;
      setAmount(max.toFixed(6));
    } else {
      const usable = (sol.amount ?? 0) - 0.02;
      if (usable <= 0) return toast.warning("Need ≥0.03 SOL");
      setAmount(usable.toFixed(3));
    }
  };

  const runSwap = async () => {
    const val = parseFloat(amount);
    if (!val) return toast.warning("Enter amount");

    const userPrefs = (() => {
      try {
        const raw = localStorage.getItem("userPrefs");
        if (!raw || raw === "undefined") return {};
        return JSON.parse(raw);
      } catch {
        return {};
      }
    })();

    const opts = { slippage: userPrefs.slippage ?? 1.0 };
    const label = direction === "solToUsdc" ? "SOL → USDC" : "USDC → SOL";

    setSwapping(true);

    const promise =
      direction === "solToUsdc"
        ? manualBuy(val, USDC_MINT, { ...opts, skipLog: true })
        : manualBuy(undefined, SOL_MINT, { ...opts, amountInUSDC: val, skipLog: true });

    toast.promise(
      promise,
      {
        loading: `🔁 Swapping ${label}…`,
        success: (res) => {
          const tx = res?.tx;
          if (!tx) return "✅ Swap confirmed";
          const url = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
          return (
            <span>
              ✅ Swap confirmed ·{" "}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                View tx
              </a>
            </span>
          );
        },
        error: (err) => `❌ ${err?.message || "Swap failed"}`,
      }
    );

    try {
      await promise;
      await fetchNetAndOpen();
    } finally {
      setSwapping(false);
      setShowSwap(false);
      setAmount("");
    }
  };

  const activeWalletLabel =
    wallets.find((w) => w.id === activeWalletId)?.label || "Select wallet";

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl shadow-lg p-6 mb-8 space-y-4">
      {/* Header with wallet selector + refresh */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-xl font-bold text-white">
          <DollarSign size={20} className="text-emerald-400" /> Wallet Balances
        </h3>

        <div className="flex items-center gap-3">
          {/* Wallet selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-white hover:border-emerald-500 transition"
                disabled={switching || wallets.length === 0}
              >
                <WalletIcon size={16} className="text-emerald-400" />
                <span className="truncate max-w-[140px]">{activeWalletLabel}</span>
                <ChevronDown size={14} className="text-zinc-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-[220px] bg-zinc-900 border border-zinc-700">
              {wallets.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400">No wallets found</div>
              ) : (
                wallets.map((w) => (
                  <DropdownMenuItem
                    key={w.id}
                    onSelect={() => handleSwitchWallet(w.id)}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{w.label}</span>
                    {w.id === activeWalletId && <Check size={16} className="text-emerald-400" />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Refresh */}
          <button
            onClick={fetchNetAndOpen}
            className="text-white hover:text-purple-400 transition"
            title="Refresh balances"
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Balances grid */}
      {!net ? (
        <p>Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <img
                src="https://assets.coingecko.com/coins/images/4128/small/solana.png"
                alt="SOL"
                className="w-5 h-5"
              />
              <span>SOL</span>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{sol.amount?.toFixed(3) ?? 0}</div>
              <div className="text-emerald-300 text-xs">${sol.valueUSD?.toFixed(2) ?? 0}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <img
                src="https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png"
                alt="USDC"
                className="w-5 h-5"
              />
              <span>USDC</span>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{usdc.amount?.toFixed(2) ?? 0}</div>
              <div className="text-emerald-300 text-xs">${usdc.valueUSD?.toFixed(2) ?? 0}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-cyan-400" />
              <span>Open</span>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{open.count}</div>
              <div className="text-emerald-300 text-xs">${open.value.toFixed(2)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-purple-400" />
              <span>Net Worth</span>
            </div>
            {/* Net Worth shown as SOL + USDC + Open */}
            <div className="text-white font-bold">${computedNetUSD}</div>
          </div>
        </div>
      )}

      {/* Swap buttons */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mt-4 w-full">
        <div className="flex justify-end w-full">
          <div className="flex gap-3">
            <button
              onClick={() => {
                setDirection("solToUsdc");
                setShowSwap(true);
              }}
              className="bg-gradient-to-r from-teal-500 to-emerald-600 px-5 py-2 rounded-full text-sm font-semibold shadow hover:scale-105 transition"
            >
              SOL → USDC
            </button>
            <button
              onClick={() => {
                setDirection("usdcToSol");
                setShowSwap(true);
              }}
              className="bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2 rounded-full text-sm font-semibold shadow hover:scale-105 transition"
            >
              USDC → SOL
            </button>
          </div>
        </div>
      </div>

      {/* Swap Modal — styled like DCA/Limit modals */}
      {showSwap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="relative w-[400px] space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-white shadow-xl">
            {/* Close (top-right) */}
            <div
              className="absolute top-3 right-3 cursor-pointer text-zinc-400 hover:text-red-400 transition-colors"
              onClick={() => !swapping && setShowSwap(false)}
            >
              ✕
            </div>

            {/* Title */}
            <h3 className="flex items-center justify-center gap-2 text-lg font-bold text-emerald-400">
              <RefreshCw size={18} className="text-cyan-400" />
              {direction === "solToUsdc" ? "Convert SOL → USDC" : "Convert USDC → SOL"}
            </h3>

            {/* Form (match DCA inputs) */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Amount (span 2) */}
              <label className="col-span-2 flex items-center">
                <input
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  placeholder="Amount"
                  className="flex-1 rounded bg-zinc-800 px-2 py-1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  onClick={setMax}
                  disabled={swapping}
                  className="ml-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-xs px-2 py-0.5 rounded"
                >
                  Max
                </button>
              </label>

              {/* Direction (readonly display for consistency) */}
              <div className="col-span-2 text-center text-[11px] text-zinc-400">
                {direction === "solToUsdc" ? "Swap SOL for USDC" : "Swap USDC for SOL"}
              </div>
            </div>

            {/* Footer (text Cancel + emerald Save) */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSwap(false)}
                disabled={swapping}
                className="text-xs text-zinc-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runSwap}
                disabled={swapping}
                className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {swapping ? "Swapping…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
