/* ──────────────────────────────────────────────────────────
   RotationBotConfig.jsx – UI for Rotation-Bot
   v3  (wallet-token bundles, per-bundle minMomentum support)
   ────────────────────────────────────────────────────────── */

import React, { useMemo, useEffect, useState } from "react";
import StrategyTooltip   from "./StrategyTooltip";
import AdvancedFields    from "../ui/AdvancedFields";
import TokenSelector     from "./TokenSelector";
import { X, Search }     from "lucide-react";  
import { ChevronDown } from "lucide-react";
import { useUser } from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";  
import { validateMint } from "@/utils/api";
import { toast, Toaster } from "sonner";
/* the parent still needs these */
export const REQUIRED_FIELDS = [
  "bundles",
  "rotationInterval",
  "maxRotations",
];

const RotationBotConfig = ({
  config = {},
  setConfig,
  disabled = false,
  children,
  customFields,
}) => {

function isValidMintFormat(mint) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");} 


const SOL_MINT  = "So11111111111111111111111111111111111111112";
 const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const [tokenMap,       setTokenMap]       = useState({});           // wallet ⇒ full token list
const [walletBalances, setWalletBalances] = useState({});           // wallet ⇒ { balance, value }
const { wallets: walletLabels = [] } = useUser();   // [{id,label,publicKey,…}]

const loadTokensFor = async (label, id) => {
  if (!label || walletBalances[label] || !id) return;               // NEW: bail if already cached
  try {
    const toks = await fetchPortfolio(id);
    setTokenMap(m => ({ ...m, [label]: toks }));

    // --- derive SOL numbers ------------------------------------------------
    const sol = toks.find(t => t.mint === SOL_MINT) || { amount: 0, price: 0 };
    const balance = Number(sol.amount) || 0;
    const value   = balance * Number(sol.price || 0);
    // -----------------------------------------------------------------------

    setWalletBalances(prev => ({ ...prev, [label]: { balance, value } }));
  } catch (err) {
    console.warn(`⚠️ loadTokensFor(${label}):`, err.message);
  }
};


  const [draftWallet, setDraftWallet] = useState("");
  const [draftTokens, setDraftTokens] = useState([]);

  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
const menuRef = React.useRef();
const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
useEffect(() => {
  const meta = walletLabels.find(w => w.label === draftWallet);
  if (meta) loadTokensFor(draftWallet, meta.id);
}, [draftWallet, walletLabels]);          // CHG
const tokenMenuRef = React.useRef();
  const [showCustomBox, setShowCustomBox] = useState(false);
  const [customMint,    setCustomMint]    = useState("");
  const [checkingMint,  setCheckingMint]  = useState(false);

  const bundles = useMemo(() => config.bundles ?? [], [config.bundles]);

  const derived = useMemo(() => {
    const allWallets = bundles.map(b => b.wallet);
    const allTokens  = [...new Set(bundles.flatMap(b => b.tokens))];
    return { wallets: allWallets, tokens: allTokens };
  }, [bundles]);
  const [draftMinMomentum, setDraftMinMomentum] = useState(() => {
  const existingBundle = bundles.find(b => b.wallet === draftWallet);
  return existingBundle?.minMomentum ?? "";
});


useEffect(() => {
  const bundle = bundles.find(b => b.wallet === draftWallet);
  setDraftMinMomentum(bundle?.minMomentum ?? "");
}, [draftWallet]);

// warm the cache so balances show immediately
useEffect(() => {
  walletLabels.forEach(w => loadTokensFor(w.label, w.id));
}, [walletLabels]);  

  useEffect(() => {
    setConfig(p => ({ ...p, ...derived, bundles }));
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [bundles]);

  useEffect(() => {
  const handler = e => {
    if (menuRef.current && !menuRef.current.contains(e.target)) {
      setWalletMenuOpen(false);
    }
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);

useEffect(() => {
  const handler = e => {
    if (
      (menuRef.current && menuRef.current.contains(e.target)) ||
      (tokenMenuRef.current && tokenMenuRef.current.contains(e.target))
    ) return;
    setWalletMenuOpen(false);
    setTokenMenuOpen(false);
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, []);

  const inputBase = "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  const changeNumber = (e) =>
    setConfig(p => ({ ...p, [e.target.name]: e.target.value === "" ? "" : +e.target.value }));

  const mintLabel = useMemo(() => (
    Object.fromEntries(Object.values(tokenMap).flat()
      .map(t => [
        t.mint,
        t.symbol?.trim() || t.name?.trim() || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`
      ]))
  ), [tokenMap]);

  const confirmBundle = () => {
    if (!draftWallet || draftTokens.length < 2) return;
    setConfig(p => ({
      ...p,
      bundles: [...bundles.filter(b => b.wallet !== draftWallet),
                { wallet: draftWallet, tokens: draftTokens, minMomentum: draftMinMomentum }],
    }));
    setDraftWallet(""); setDraftTokens([]); setDraftMinMomentum(10);
  };

return (
  <>
    {/* Info Box */}
<div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
  🔁 Rotates capital into the strongest-momentum tokens across selected wallets.
  <br />
  💡 <strong>Note:</strong> All wallets in this bot rotate based on the <strong>same token list</strong>.
  <details className="mt-1 text-zinc-400">
    <summary className="cursor-pointer underline underline-offset-2">More info</summary>
    <ul className="list-disc pl-5 mt-1 space-y-1">
      <li>To use different token sets per wallet, create separate bot instances.</li>
      <li>To rotate multiple wallets on the same list, include them here together.</li>
    </ul>
  </details>
</div>

    <div className="space-y-4">
      {/* Wallet + Token Selectors Row */}
      <div className="grid sm:grid-cols-2 gap-4 items-end">
        {/* Wallet Selector */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium flex items-center gap-1">
            Wallet <StrategyTooltip name="wallets" />
          </span>
          <div className="relative flex-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setWalletMenuOpen(o => !o)}
              className={`w-full flex justify-between items-center ${inputBase} cursor-pointer`}
            >
              <span>{draftWallet || "Select wallet…"}</span>
              <ChevronDown className="w-4 h-4" />
            </button>

            {walletMenuOpen && (
              <div
                ref={menuRef}
                className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg"
              >
                <div className="max-h-60 overflow-y-auto">
                  {walletLabels.map(w => {
                    const { balance = 0, value = 0 } = walletBalances[w.label] || {};
                    return (
                      <div
                        key={w.label}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setDraftWallet(w.label);
                          setDraftTokens([]);
                          loadTokensFor(w.label, w.id);
                          setWalletMenuOpen(false);
                        }}
                        className={`px-3 py-2 text-sm hover:bg-emerald-700/40 cursor-pointer ${
                          draftWallet === w.label ? "bg-emerald-700/30" : ""
                        }`}
                      >
                        {w.label} — {balance.toFixed(2)} SOL (${value.toFixed(2)})
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Token Selector */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium flex items-center gap-1">
            Tokens <StrategyTooltip name="tokens" />
          </span>
          <div className="relative flex-1">
            <button
              type="button"
              disabled={disabled || !draftWallet}
              onClick={() => setTokenMenuOpen(o => !o)}
              className={`w-full flex justify-between items-center ${inputBase} cursor-pointer`}
            >
              <span>
                {draftTokens.length > 0
                  ? `${draftTokens.length} selected`
                  : "Select tokens…"}
              </span>
              <ChevronDown className="w-4 h-4" />
            </button>

            {tokenMenuOpen && (
              <div
                ref={tokenMenuRef}
                className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg max-h-60 overflow-y-auto flex flex-col"
              >
                <div className="flex-1 overflow-y-auto">
                  {(tokenMap[draftWallet] || []).map(t => (
                    <div
                      key={t.mint}
                      onMouseDown={e => {
                        e.stopPropagation();
                        setDraftTokens(d =>
                          d.includes(t.mint)
                            ? d.filter(x => x !== t.mint)
                            : [...d, t.mint]
                        );
                      }}
                      className={`px-2 py-1 text-xs hover:bg-emerald-700/40 cursor-pointer flex justify-between items-center ${
                        draftTokens.includes(t.mint) ? "bg-emerald-700/30" : ""
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-white">
                          {t.symbol || t.name || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {`${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`}
                        </span>
                      </div>
                      <div className="text-right text-[11px]">
                        <div>{(+t.amount || 0).toFixed(2)}</div>
                        <div className="text-zinc-400">(${(+t.valueUsd || 0).toFixed(2)})</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  onMouseDown={e => {
                    e.stopPropagation();
                    setTokenMenuOpen(false);
                  }}
                  className="sticky bottom-0 px-3 py-2 text-xs text-center text-rose-300 hover:bg-zinc-700/40 cursor-pointer border-t border-zinc-700 bg-zinc-800"
                >
                  ✕ Close
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Custom Mint Button + Input */}
      {!showCustomBox ? (
<button
  onClick={() => setShowCustomBox(true)}
  className="px-3 py-2 rounded-md border border-indigo-500 text-indigo-300 hover:bg-indigo-600/20 transition text-sm font-medium"
>
  ➕ Add Custom Mint
</button>
      ) : (
        <div className="flex gap-2 items-end">
          <input
            className={inputBase + " flex-1"}
            placeholder="Paste mint address"
            value={customMint}
            onChange={e => setCustomMint(e.target.value.trim())}
            disabled={checkingMint}
          />
          <button
            className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
            disabled={checkingMint || !isValidMintFormat(customMint)}
            onClick={async () => {
              setCheckingMint(true);
              try {
                const result = await validateMint(customMint);
                if (!result.ok) throw new Error(`Mint not valid: ${result.reason}`);
                setDraftTokens(t =>
                  t.includes(customMint) ? t : [...t, customMint]
                );
                setCustomMint("");
                setShowCustomBox(false);
              } catch (err) {
                console.error(err.message);
                toast.error(err.message || "Mint validation failed");
              } finally {
                setCheckingMint(false);
              }
            }}
          >
            {checkingMint ? "…" : "Add"}
          </button>
          <button
            className="text-red-400 text-sm"
            onClick={() => {
              setShowCustomBox(false);
              setCustomMint("");
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Selected Token Chips */}
      {draftTokens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {draftTokens.map(m => (
            <span key={m} className="bg-zinc-800 px-2 py-0.5 rounded-full text-xs text-zinc-300 flex items-center gap-1">
              {mintLabel[m] ?? `${m.slice(0, 4)}…${m.slice(-4)}`}
              <button
                onClick={() => setDraftTokens(t => t.filter(x => x !== m))}
                className="text-red-400 ml-1"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Confirm Row */}
<div className="flex gap-2 items-end mt-2">
  <button
    onClick={confirmBundle}
    disabled={disabled || !draftWallet || draftTokens.length < 2}
    className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50"
  >
    ➕ Confirm Wallet + Tokens
  </button>
</div>

{/* ─── Price‑Change ≥ % Row (moved & restyled) ─── */}
<label className="flex flex-col text-sm font-medium gap-1 mt-2">
  <span className="flex items-center gap-1">
    Only Rotate if % Change Over&nbsp;
    <span className="text-zinc-400 italic">(momentum ≥ %)</span>
    <StrategyTooltip name="minMomentum" />
  </span>

  <input
    type="number"
    value={draftMinMomentum}
    onChange={e => setDraftMinMomentum(+e.target.value)}
    step="any"
    disabled={disabled}
    className={
      "w-28 min-h-[34px] text-sm pl-3 pr-2 py-2 rounded-md border border-zinc-700 " +
      "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
      "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition"
    }
  />
</label>
    </div>

      {bundles.length > 0 && (
        <div className="mt-6 space-y-2">
          {bundles.map(b => (
            <div key={b.wallet} className="border border-zinc-700 rounded-lg p-3 bg-zinc-900">
              <div className="flex justify-between items-center">
                <span className="text-indigo-300 font-semibold">{b.wallet}</span>
                <span className="text-xs text-emerald-400 ml-2">Price Change ≥ %: {b.minMomentum ?? 10}%</span>
                {!disabled && (
                  <button
                    className="text-red-400 hover:text-red-500 text-xs"
                    onClick={() =>
                      setConfig(p => {
                        const nextBundles = p.bundles.filter(x => x.wallet !== b.wallet);
                        const stillUsed   = new Set(nextBundles.flatMap(z => z.tokens));
                        return {
                          ...p,
                          bundles: nextBundles,
                          wallets: nextBundles.map(z => z.wallet),
                          tokens : [...stillUsed],
                        };
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1 mt-2">
                {b.tokens.map(m => (
                  <span key={m} className="bg-emerald-700/30 px-2 py-0.5 rounded-full text-xs">
                    {mintLabel[m] ?? m.slice(0,4)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

{/* ─── Price‑Change Window ─── */}
<label className="flex flex-col text-sm font-medium gap-1 mt-4">
  <span className="flex items-center gap-1">
    Price‑Change Window&nbsp;
    <span className="text-zinc-400 italic">(momentum look‑back)</span>
    <StrategyTooltip name="priceChangeWindow" />
  </span>

  {/*
    Allowed frames that Birdeye & backend support.
    Empty string = let RotationBot auto‑pick from rotationInterval.
  */}
  {(() => {
    const wins = ["","5m","10m","30m","1h","2h","4h","8h","24h"];
    const inp =  
      "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
      "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
      "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

    return (
      <div className="relative">
        <select
          name="priceChangeWindow"
          value={config.priceChangeWindow ?? ""}
          onChange={e => setConfig(p => ({ ...p, priceChangeWindow: e.target.value }))}
          disabled={disabled}
          className={`${inp} appearance-none pr-10`}
        >
          <option value="">Auto (match interval)</option>
          {wins.slice(1).map(w => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
      </div>
    );
  })()}
</label>
      <AdvancedFields
        config={config}
        setConfig={setConfig}
        disabled={disabled}
        fields={customFields ?? [
          { label: "Per-token Cooldown (s)", name: "cooldown" },
          { label: "Max Slippage (%)",       name: "maxSlippage" },
          { label: "Priority Fee (lamports)",name: "priorityFeeLamports" },
        ]}
      />
      
      {children}
    </>
  );
};

export default RotationBotConfig;
