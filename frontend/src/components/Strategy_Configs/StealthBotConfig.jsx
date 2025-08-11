/* StealthBotConfig.jsx – UI for simple split-buy (“Stealth”) bot */
import React, { useEffect, useMemo, useState } from "react";
import StrategyTooltip   from "./StrategyTooltip";
import AdvancedFields    from "../ui/AdvancedFields";
import { X, Search }     from "lucide-react";  
import { ChevronDown } from "lucide-react";
import { useUser } from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";  
import { authFetch } from "@/utils/authFetch";

export const REQUIRED_FIELDS = ["wallets", "tokenMint", "positionSize"];

export default function StealthBotConfig({
  config   = {},
  setConfig,
  disabled = false,
  children,
}) {
  const isValidAddr = (s = "") => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

  /* ── backend look-ups ── */
const [tokenMap,     setTokenMap]     = useState({});
const [walletMenuOpen, setWalletMenuOpen] = useState(false);
 const SOL_MINT  = "So11111111111111111111111111111111111111112";
 const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const { wallets: walletLabels = [] } = useUser();   // [{id,label,publicKey,…}]
const [walletBalances,   setWalletBalances] = useState({});


 const menuRef = React.useRef(null);
 useEffect(() => {
   if (!walletMenuOpen) return;
   const handler = e => {
     if (menuRef.current && !menuRef.current.contains(e.target)) {
       setWalletMenuOpen(false);
     }
   };
   document.addEventListener("mousedown", handler);
   return () => document.removeEventListener("mousedown", handler);
 }, [walletMenuOpen]);

  /* ------------- helper: fetch + cache tokens per wallet ------------- */
const loadTokens = async (label, id) => {
  if (!label || tokenMap[label] || !id) return;  // already fetched / empty arg

    try {
      const tokens = await fetchPortfolio(id); 
      if (!Array.isArray(tokens)) throw new Error("Invalid tokens payload");
      /* derive SOL meta */
      const solTok = tokens.find(t => t.mint === SOL_MINT) || { amount: 0, price: 0 };
      const balance = Number(solTok.amount) || 0;                 // ⚡ SOL amount
      const value   = balance * Number(solTok.price || 0);        // ⚡ USD value;
      const solData = {
        amount  : solTok.amount,
        price   : solTok.price,
        valueUSD: +(solTok.amount * solTok.price).toFixed(2),
      };

setTokenMap(m => ({ ...m, [label]: tokens }));
      +    /* 🔥 inject the numbers into walletLabels */
   /* save just the SOL numbers for quick display */
setWalletBalances(prev => ({
  ...prev,
  [label]: { balance, value }
}));
    } catch (err) {
      console.warn(`⚠️ Failed to load tokens for ${label}:`, err.message);
    }
  };

  useEffect(() => {
  walletLabels.forEach(w => loadTokens(w.label, w.id));
}, [walletLabels]);

    /* ------------ auto‑prefetch SOL balances for visible wallets ----------- */
useEffect(() => {
  if (!Array.isArray(config.wallets)) return;
  config.wallets.forEach((lbl) => {
    const meta = walletLabels.find(w => w.label === lbl);
    loadTokens(lbl, meta?.id);
  });
}, [config.wallets, walletLabels]);


  /* ------------- derived helpers ------------- */
const walletsWithSol = useMemo(() => {
  return (config.wallets || []).map((w) => {
    const meta = walletLabels.find((wl) => wl.label === w) || {};
    return {
      label: w,
      sol: meta.balance ?? 0,
      solValue: meta.value ?? 0,
    };
  });
}, [config.wallets, walletLabels]);

  /* ---------------- UI callbacks ---------------- */
  const addWallet = (label) => {
    if (!label || config.wallets?.includes(label)) return;
    setConfig({ ...config, wallets: [...(config.wallets || []), label] });
    loadTokens(label);
  };

  const removeWallet = (label) => {
    const next = (config.wallets || []).filter((l) => l !== label);
    setConfig({ ...config, wallets: next });
  };


  

  /* ── local UI state ── */
  const [selectedWallet, setSelectedWallet] = useState("");
  const [customMint,     setCustomMint]     = useState("");
  const [checking,       setChecking]       = useState(false);
  const [stats,          setStats]          = useState({ ok: 0, errors: 0 });

  /* runtime telemetry */
  useEffect(() => {
    const onStat = ev => {
      if (ev.botId !== (config.botId || "manual-stealth")) return;
      setStats(s => ({ ok: s.ok + (ev.ok ? 1 : 0), errors: s.errors + (ev.ok ? 0 : 1) }));
    };
    window.addEventListener("stealthbot:stat", onStat);
    return () => window.removeEventListener("stealthbot:stat", onStat);
  }, [config.botId]);

  const update = kv => setConfig(p => ({ ...p, ...kv }));

  /* mint → friendly label */
  const mintLabel = useMemo(() =>
    Object.fromEntries(
      Object.values(tokenMap)
        .flat()
        .map(t => [t.mint, t.symbol || t.name || `${t.mint.slice(0,4)}…`])
    ), [tokenMap]);

  const inputBase =
    "w-full px-3 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white text-sm";

  /* ─────────────────────────── UI ─────────────────────────── */
  return (
    <>
      {/* description */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
        🥷 Stealth-Bot splits a SOL amount across many wallets and buys the&nbsp;
        <strong>same token</strong> from each, hiding your total size.
      </div>

      {/* wallet selector with ADD button */}
      <div className="mb-6">

<label className="flex flex-col text-sm font-medium gap-1">
  <span className="flex items-center gap-1">
    Wallets <StrategyTooltip name="wallets" />
  </span>

  {/* ── custom dropdown + “Add” inline ── */}
  <div className="flex gap-2 items-end relative w-full">
    {/* trigger */}
    <div className="relative flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setWalletMenuOpen(o => !o)}
        className={`w-full flex justify-between items-center ${inputBase} cursor-pointer`}
      >
        <span>{selectedWallet || "Select wallet…"}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {/* menu */}
      {walletMenuOpen && (
        <div
          ref={menuRef}                             
          className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700
                     rounded-md shadow-lg max-h-60 overflow-y-auto"
        >
{walletLabels.map(w => {
  const { balance = 0, value = 0 } = walletBalances[w.label] || {};
  return (
    <div
      key={w.label}
      onMouseDown={e => { e.stopPropagation(); setSelectedWallet(w.label); setWalletMenuOpen(false); }}
      className={`px-3 py-2 text-sm hover:bg-emerald-700/40 cursor-pointer ${
        selectedWallet === w.label ? "bg-emerald-700/30" : ""
      }`}
    >
      {w.label} — {balance.toFixed(2)} SOL (${value.toFixed(2)})
    </div>
  );
})}

        </div>
      )}
    </div>

    {/* manual “+ Add” button (optional safety) */}
    <button
      type="button"
      disabled={
        disabled ||
        !selectedWallet ||
        (config.wallets || []).includes(selectedWallet)
      }
      onClick={() => {
        update({ wallets: [ ...(config.wallets || []), selectedWallet ] });
          const meta = walletLabels.find(w => w.label === selectedWallet);
          loadTokens(selectedWallet, meta?.id);        
          setSelectedWallet("");
      }}
      className="px-3 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600
                 text-white text-sm disabled:opacity-40 transition"
    >
      + Add
    </button>
  </div>
</label>

        {/* pretty pills */}
        {config.wallets?.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4">
            {config.wallets.map(label => {
              const bal = walletBalances[label]?.balance ?? 0;
              const val = walletBalances[label]?.value   ?? 0;
              const wMeta = walletLabels.find(w => w.label === label);

              return (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 shadow-sm
                             bg-gradient-to-br from-emerald-600/40 to-emerald-700/30
                             border border-emerald-400 text-emerald-100
                             text-sm pl-3 pr-2 py-1 rounded-full"
                >
                  <span className="font-semibold">{label}</span>
                  <span className="text-[11px] bg-emerald-800 px-1.5 rounded">
                    {bal.toFixed(2)} SOL (${val.toFixed(2)})
                  </span>
                  <button
                    onClick={() =>
                      update({ wallets: config.wallets.filter(v => v !== label) })
                    }
                    className="ml-1 hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* target token */}
      <div className="mb-6">
        <span className="text-sm font-medium flex items-center gap-1">
          Target Token <StrategyTooltip name="token" />
        </span>

        <div className="flex gap-2 items-end mt-2">
          <input
            className={inputBase + " flex-1"}
            placeholder="Paste mint address"
            value={customMint}
            onChange={e => setCustomMint(e.target.value.trim())}
            disabled={disabled}
          />
          <button
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded
                       disabled:opacity-50 transition"
            disabled={checking || !isValidAddr(customMint) || disabled}
            onClick={async () => {
              setChecking(true);
              try {
                // Validate mint via authFetch; CSRF & cookies included automatically
                await authFetch('/api/wallets/validate-mint', {
                  method: 'POST',
                  body: JSON.stringify({ mint: customMint }),
                });
                update({ tokenMint: customMint });
                setCustomMint('');
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "…" : "Add"}
          </button>
        </div>

        {config.tokenMint && (
          <span
            className="inline-flex items-center gap-2 mt-3
                       bg-indigo-600/20 border border-indigo-400
                       text-indigo-200 text-sm pl-3 pr-2 py-0.5 rounded-full"
          >
            <span>
              Target&nbsp;Token:&nbsp;
              <strong>
                {mintLabel[config.tokenMint] ??
                  `${config.tokenMint.slice(0, 4)}…`}
              </strong>
            </span>
            {/* remove‑token button */}
            <button
              className="ml-1 hover:text-red-400 flex-shrink-0"
              onClick={() => update({ tokenMint: undefined })}
              title="Remove token"
              type="button"
            >
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      {/* spend per wallet */}
      <label className="flex flex-col text-sm font-medium gap-1 mb-6">
        Spend per Wallet (SOL)
        <input
          type="number" step="0.001" min="0"
          value={config.positionSize ?? 0.02}
          onChange={e => update({ positionSize: +e.target.value })}
          disabled={disabled}
          className={inputBase}
        />
      </label>

      {/* advanced */}
      <AdvancedFields
        config={config} setConfig={setConfig} disabled={disabled}
        fields={[
          { label:"Slippage (%)",                name:"slippage" },
          { label:"Max Slippage (%)",            name:"maxSlippage" },
          { label:"Priority Fee (lamports)",     name:"priorityFeeLamports" },
          { label:"Loop Interval (ms, 0 = once)",name:"rotationInterval" },
        ]}
      />

      {children}
    </>
  );
}
