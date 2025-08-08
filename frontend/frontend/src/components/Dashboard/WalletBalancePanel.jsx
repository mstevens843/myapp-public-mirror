// frontend/components/WalletBalancePanel.jsx
import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
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
import { fetchCurrentPrice, getOpenTrades } from "../../utils/trades_positions";
import { getWalletNetworth } from "../../utils/api";

// 🔥 NEW: pull wallet APIs so we can switch from here
import {
  loadWallet,
  fetchActiveWallet,
  setActiveWalletApi,
} from "@/utils/auth";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

export default function WalletBalancePanel() {
  const [net, setNet] = useState(null);
  const [open, setOpen] = useState({ count: 0, value: 0 });
  const [loading, setLoading] = useState(false);

  const [showSwap, setShowSwap] = useState(false);
  const [direction, setDirection] = useState("solToUsdc");
  const [amount, setAmount] = useState("");

  // 🔥 NEW: wallets + active wallet
  const [wallets, setWallets] = useState([]);
  const [activeWalletId, setActiveWalletId] = useState(null);
  const [switching, setSwitching] = useState(false);

  const STABLE_MINTS = new Set([
    USDC_MINT,
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
    "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT",
  ]);

  /* ---------------- Wallet bootstrap ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const ws = (await loadWallet()) || [];
        setWallets(ws);
        const id =
          (await fetchActiveWallet()) || (ws[0] && ws[0].id) || null;
        setActiveWalletId(id);
      } catch (e) {
        console.error("wallet bootstrap failed:", e);
      }
    })();
  }, []);

  /* ---------------- Balances / open trades ---------------- */
  const fetchNetAndOpen = async () => {
    try {
      setLoading(true);
      const wJson = await getWalletNetworth(); // backend should respect active wallet
      const allTrades = await getOpenTrades();
      const trades = allTrades.filter((t) => !STABLE_MINTS.has(t.mint));

      let totalUSD = 0;
      await Promise.all(
        trades.map(async (t) => {
          let usd = t.usdValue;
          if (typeof usd !== "number") {
            try {
              const price = await fetchCurrentPrice(t.mint);
              usd = price * Number(t.outAmount ?? 0) / 10 ** (t.decimals ?? 9);
            } catch {
              usd = 0;
            }
          }
          totalUSD += usd;
        })
      );

      setNet(wJson);
      setOpen({ count: trades.length, value: +totalUSD.toFixed(2) });
    } catch (err) {
      console.error("❌ net/open fetch:", err);
      toast.error("Could not refresh balances.");
    } finally {
      setLoading(false);
    }
  };

  // initial + whenever wallet changes
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
        const label =
          wallets.find((w) => w.id === id)?.label || `Wallet ${id}`;
        toast.success(`Active wallet: ${label}`);
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
  const displayNet = net ? (net.totalValueUSD + open.value).toFixed(2) : "0.00";

  const setMax = () => {
    if (direction === "usdcToSol") {
      if (!usdc.amount) return;
      const max = Math.floor(usdc.amount * 1e6 - 1) / 1e6;
      setAmount(max.toFixed(6));
    } else {
      const usable = (sol.amount ?? 0) - 0.02;
      if (usable <= 0) return toast.warn("Need ≥0.03 SOL");
      setAmount(usable.toFixed(3));
    }
  };

  const runSwap = async () => {
    const val = parseFloat(amount);
    if (!val) return toast.warn("Enter amount");

    const userPrefs = JSON.parse(localStorage.getItem("userPrefs") || "{}");
    const opts = { slippage: userPrefs.slippage ?? 1.0 };

    const label = direction === "solToUsdc" ? "SOL → USDC" : "USDC → SOL";
    const promise =
      direction === "solToUsdc"
        ? manualBuy(val, USDC_MINT, { ...opts, skipLog: true })
        : manualBuy(undefined, SOL_MINT, {
            ...opts,
            amountInUSDC: val,
            skipLog: true,
          });

    toast.promise(
      promise,
      {
        pending: `🔁 Swapping ${label}…`,
        success: "✅ Swap confirmed",
        error: { render: ({ data }) => `❌ ${data.message || "Swap failed"}` },
      },
      { position: "bottom-right", theme: "dark" }
    );

    try {
      await promise;
      await fetchNetAndOpen();
    } finally {
      setShowSwap(false);
      setAmount("");
    }
  };

  const targetToken = localStorage.getItem("targetToken") || "";

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
          {/* 🔥 NEW: Wallet selector */}
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
                <div className="px-3 py-2 text-sm text-zinc-400">
                  No wallets found
                </div>
              ) : (
                wallets.map((w) => (
                  <DropdownMenuItem
                    key={w.id}
                    onSelect={() => handleSwitchWallet(w.id)}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{w.label}</span>
                    {w.id === activeWalletId && (
                      <Check size={16} className="text-emerald-400" />
                    )}
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
              <div className="text-white font-semibold">
                {sol.amount?.toFixed(3) ?? 0}
              </div>
              <div className="text-emerald-300 text-xs">
                ${sol.valueUSD?.toFixed(2) ?? 0}
              </div>
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
            <div className="text-white font-semibold">
              {usdc.amount?.toFixed(2) ?? 0}
            </div>
            <div className="text-emerald-300 text-xs">
              ${usdc.valueUSD?.toFixed(2) ?? 0}
            </div>
          </div>
        </div>

          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-cyan-400" />
              <span>Open</span>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{open.count}</div>
              <div className="text-emerald-300 text-xs">
                ${open.value.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 p-4 rounded-lg">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-purple-400" />
              <span>Net Worth</span>
            </div>
            <div className="text-white font-bold">${displayNet}</div>
          </div>
        </div>
      )}

      {/* Swap buttons */}
<div className="flex flex-col md:flex-row items-start md:items-center gap-3 mt-4 w-full">
  {/* Left: Quick Links */}
  {/* <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
    <span className="italic">Links:</span>
    <a
      href={`https://birdeye.so/token/${targetToken}`}
      target="_blank"
      rel="noreferrer"
      className="text-blue-400 hover:underline"
    >
      Birdeye
    </a>
    <span>|</span>
    <a
      href={`https://dexscreener.com/solana/${targetToken}`}
      target="_blank"
      rel="noreferrer"
      className="text-blue-400 hover:underline"
    >
      DEX Screener
    </a>
  </div> */}

  {/* Right: Swap Buttons */}
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

      {/* Modal unchanged */}
      {showSwap && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-zinc-800 w-80 rounded-xl p-6 shadow-lg border border-zinc-700">
            <h3 className="text-lg font-semibold mb-4 text-center">
              {direction === "solToUsdc"
                ? "Convert SOL → USDC"
                : "Convert USDC → SOL"}
            </h3>
            <div className="relative mb-6">
              <input
                type="number"
                min="0"
                step="any"
                autoFocus
                placeholder="Amount"
                className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-600 focus:outline-none text-white pr-16"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button
                onClick={setMax}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-zinc-700 hover:bg-zinc-600 text-xs px-2 py-0.5 rounded"
              >
                Max
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSwap(false)}
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 rounded py-2"
              >
                Cancel
              </button>
              <button
                onClick={runSwap}
                className="flex-1 bg-green-600 hover:bg-green-700 rounded py-2 font-semibold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
