/* ──────────────────────────────────────────────────────────
   RotationBotConfig.jsx — Sniper-style tabbed layout (Core / Execution / Advanced)
   v3 (wallet-token bundles, per-bundle minMomentum support)
   Solid (non-transparent) backgrounds, darker container, pretty toggle, no “Apply” button
   ────────────────────────────────────────────────────────── */

import React, { useMemo, useEffect, useState, useRef } from "react";
import StrategyTooltip   from "./StrategyTooltip";
import AdvancedFields    from "../ui/AdvancedFields";
import { ChevronDown }   from "lucide-react";
import { useUser }       from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";
import { validateMint }  from "@/utils/api";
import { toast }         from "sonner";

/* the parent still needs these */
export const REQUIRED_FIELDS = ["bundles", "rotationInterval", "maxRotations"];

export const OPTIONAL_FIELDS = [
  "priceChangeWindow",
  "cooldown",
  "maxSlippage",
  "priorityFeeLamports",
];

/* ────────────────── Shared UI helpers (solid backgrounds) ────────────────── */
const Card = ({ title, right, children, className = "" }) => (
  <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 sm:p-4 ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between mb-3">
        {title ? <div className="text-sm font-semibold text-zinc-200">{title}</div> : <div />}
        {right}
      </div>
    )}
    {children}
  </div>
);

const Section = ({ children }) => (
  <div className="grid gap-4 md:gap-5 sm:grid-cols-2">{children}</div>
);

const TabButton = ({ active, onClick, children, badge }) => (
  <button
    onClick={onClick}
    className={`relative px-3 sm:px-4 py-2 text-sm transition
      ${active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
  >
    <span className="pb-1">{children}</span>
    <span
      className={`absolute left-0 right-0 -bottom-[1px] h-[2px] transition
        ${active ? "bg-emerald-400" : "bg-transparent"}`}
    />
    {badge > 0 && (
      <span className="ml-2 inline-flex items-center justify-center text-[10px] rounded-full px-1.5 py-0.5 bg-red-600 text-white">
        {badge}
      </span>
    )}
  </button>
);

/* Tabs -> keys for error badges */
const TAB_KEYS = {
  core: ["bundles", "priceChangeWindow"],
  execution: ["rotationInterval", "maxRotations", "priorityFeeLamports"],
  advanced: ["cooldown", "maxSlippage"],
};

/* ───────────────────────────── Validation ───────────────────────────── */
const validateRotationBot = (cfg = {}) => {
  const errs = [];
  const bundles = cfg.bundles ?? [];
  if (!Array.isArray(bundles) || bundles.length === 0) {
    errs.push("bundles must include at least one wallet+token set.");
  } else {
    for (const b of bundles) {
      if (!b?.wallet) errs.push("bundles: wallet is required.");
      if (!Array.isArray(b?.tokens) || b.tokens.length < 2) {
        errs.push("bundles: each wallet needs ≥ 2 tokens.");
      }
    }
  }
  if (cfg.rotationInterval === "" || cfg.rotationInterval === undefined || Number.isNaN(+cfg.rotationInterval) || +cfg.rotationInterval <= 0) {
    errs.push("rotationInterval must be > 0 ms.");
  }
  if (cfg.maxRotations === "" || cfg.maxRotations === undefined || Number.isNaN(+cfg.maxRotations) || +cfg.maxRotations <= 0) {
    errs.push("maxRotations must be ≥ 1.");
  }
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0, advanced: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k.toLowerCase()))).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += (errors.length - categorized);
  return counts;
};

/* ───────────────────────────── Component ───────────────────────────── */
const RotationBotConfig = ({
  config = {},
  setConfig,
  disabled = false,
  children,
  customFields,
}) => {
  /* helpers */
  function isValidMintFormat(mint) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");
  }

  const SOL_MINT  = "So11111111111111111111111111111111111111112";

  /* state */
  const { wallets: walletLabels = [] } = useUser(); // [{id,label,publicKey,…}]
  const [tokenMap,       setTokenMap]       = useState({}); // label -> tokens[]
  const [walletBalances, setWalletBalances] = useState({}); // label -> { balance, value }

  const [draftWallet, setDraftWallet] = useState("");
  const [draftTokens, setDraftTokens] = useState([]);
  const [draftMinMomentum, setDraftMinMomentum] = useState("");

  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [tokenMenuOpen,  setTokenMenuOpen]  = useState(false);
  const menuRef       = useRef(null);
  const tokenMenuRef  = useRef(null);

  const [showCustomBox, setShowCustomBox] = useState(false);
  const [customMint,    setCustomMint]    = useState("");
  const [checkingMint,  setCheckingMint]  = useState(false);

  /* defaults */
  const defaults = {
    bundles: [],
    rotationInterval: 600_000, // 10m ms
    maxRotations: 50,
    priceChangeWindow: "",     // auto
    cooldown: "",
    maxSlippage: "",
    priorityFeeLamports: "",   // μlam
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* derived (wallets/tokens) */
  const bundles = useMemo(() => merged.bundles ?? [], [merged.bundles]);
  const derived = useMemo(() => {
    const allWallets = bundles.map((b) => b.wallet);
    const allTokens  = [...new Set(bundles.flatMap((b) => b.tokens))];
    return { wallets: allWallets, tokens: allTokens };
  }, [bundles]);

  /* cache/load wallet tokens */
  const loadTokensFor = async (label, id) => {
    if (!label || walletBalances[label] || !id) return;
    try {
      const toks = await fetchPortfolio(id);
      setTokenMap((m) => ({ ...m, [label]: toks }));
      const sol = toks.find((t) => t.mint === SOL_MINT) || { amount: 0, price: 0 };
      const balance = Number(sol.amount) || 0;
      const value   = balance * Number(sol.price || 0);
      setWalletBalances((prev) => ({ ...prev, [label]: { balance, value } }));
    } catch (err) {
      console.warn(`⚠️ loadTokensFor(${label}):`, err?.message || err);
    }
  };

  /* keep config in sync with derived */
  useEffect(() => {
    setConfig((p) => ({ ...p, ...derived, bundles }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundles]);

  /* open/close menus by click-outside */
  useEffect(() => {
    const handler = (e) => {
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

  /* prewarm caches */
  useEffect(() => {
    walletLabels.forEach((w) => loadTokensFor(w.label, w.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletLabels.length]);

  /* keep per-bundle momentum draft in sync with wallet selection */
  useEffect(() => {
    const bundle = bundles.find((b) => b.wallet === draftWallet);
    setDraftMinMomentum(bundle?.minMomentum ?? "");
  }, [draftWallet, bundles]);

  /* mint label map */
  const mintLabel = useMemo(
    () =>
      Object.fromEntries(
        Object.values(tokenMap)
          .flat()
          .map((t) => [
            t.mint,
            t.symbol?.trim() || t.name?.trim() || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
          ])
      ),
    [tokenMap]
  );

  /* field styles */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";
  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  /* validation + badges */
  const errors = validateRotationBot(merged);
  const tabErr = countErrorsForTab(errors);

  /* tabs */
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* actions */
  const confirmBundle = () => {
    if (!draftWallet || draftTokens.length < 2) return;
    setConfig((p) => ({
      ...p,
      bundles: [
        ...bundles.filter((b) => b.wallet !== draftWallet),
        { wallet: draftWallet, tokens: draftTokens, minMomentum: draftMinMomentum || 10 },
      ],
    }));
    setDraftWallet("");
    setDraftTokens([]);
    setDraftMinMomentum("");
  };

  /* Core Tab: wallet + tokens + momentum + window */
  const CoreTab = () => (
    <>
      <Section>
        <Card title="Rotation Setup" className="sm:col-span-2">
          <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
            🔁 Rotates capital into the strongest-momentum tokens across selected wallets.
            <br />
            💡 <strong>Note:</strong> All wallets in this bot rotate based on the{" "}
            <strong>same token list</strong>.
          </div>

          {/* Wallet + Tokens */}
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            {/* Wallet Selector */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Wallet</span>
                <StrategyTooltip name="wallets" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setWalletMenuOpen((o) => !o)}
                  className={`${fieldWrap} w-full flex items-center justify-between text-left`}
                >
                  <span className="text-sm px-1.5">
                    {draftWallet || "Select wallet…"}
                  </span>
                  <ChevronDown className="w-4 h-4 text-zinc-400 mr-1" />
                </button>

                {walletMenuOpen && (
                  <div
                    ref={menuRef}
                    className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg"
                  >
                    <div className="max-h-60 overflow-y-auto">
                      {walletLabels.map((w) => {
                        const { balance = 0, value = 0 } = walletBalances[w.label] || {};
                        return (
                          <div
                            key={w.label}
                            onMouseDown={(e) => {
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
                            {w.label} — {balance.toFixed(2)} SOL (${value.toFixed(2)})
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Token Selector */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Tokens</span>
                <StrategyTooltip name="tokens" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  disabled={disabled || !draftWallet}
                  onClick={() => setTokenMenuOpen((o) => !o)}
                  className={`${fieldWrap} w-full flex items-center justify-between text-left`}
                >
                  <span className="text-sm px-1.5">
                    {draftTokens.length > 0 ? `${draftTokens.length} selected` : "Select tokens…"}
                  </span>
                  <ChevronDown className="w-4 h-4 text-zinc-400 mr-1" />
                </button>

                {tokenMenuOpen && (
                  <div
                    ref={tokenMenuRef}
                    className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg max-h-60 overflow-y-auto flex flex-col"
                  >
                    <div className="flex-1 overflow-y-auto">
                      {(tokenMap[draftWallet] || []).map((t) => (
                        <div
                          key={t.mint}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraftTokens((d) =>
                              d.includes(t.mint) ? d.filter((x) => x !== t.mint) : [...d, t.mint]
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
                      onMouseDown={(e) => {
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

          {/* Add Custom Mint */}
          {!showRequiredOnly && (
            <div className="mt-3">
              {!showCustomBox ? (
                <button
                  onClick={() => setShowCustomBox(true)}
                  className="px-3 py-1.5 rounded-md border border-indigo-500 text-indigo-300 hover:bg-indigo-600/20 transition text-xs font-medium"
                >
                  ➕ Add Custom Mint
                </button>
              ) : (
                <div className="flex gap-2 items-end">
                  <div className={fieldWrap + " flex-1"}>
                    <input
                      className={inp}
                      placeholder="Paste mint address"
                      value={customMint}
                      onChange={(e) => setCustomMint(e.target.value.trim())}
                      disabled={checkingMint}
                    />
                  </div>
                  <button
                    className="px-3 py-2 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
                    disabled={checkingMint || !isValidMintFormat(customMint)}
                    onClick={async () => {
                      setCheckingMint(true);
                      try {
                        const result = await validateMint(customMint);
                        if (!result.ok) throw new Error(`Mint not valid: ${result.reason}`);
                        setDraftTokens((t) => (t.includes(customMint) ? t : [...t, customMint]));
                        setCustomMint("");
                        setShowCustomBox(false);
                      } catch (err) {
                        console.error(err?.message || err);
                        toast.error(err?.message || "Mint validation failed");
                      } finally {
                        setCheckingMint(false);
                      }
                    }}
                  >
                    {checkingMint ? "…" : "Add"}
                  </button>
                  <button
                    className="text-red-400 text-xs"
                    onClick={() => {
                      setShowCustomBox(false);
                      setCustomMint("");
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Selected token chips */}
          {draftTokens.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {draftTokens.map((m) => (
                <span
                  key={m}
                  className="bg-zinc-800 px-2 py-0.5 rounded-full text-xs text-zinc-300 flex items-center gap-1"
                >
                  {mintLabel[m] ?? `${m.slice(0, 4)}…${m.slice(-4)}`}
                  <button
                    onClick={() => setDraftTokens((t) => t.filter((x) => x !== m))}
                    className="text-red-400 ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Per-bundle momentum + confirm */}
          <div className="grid sm:grid-cols-2 gap-4 mt-3 items-end">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Only Rotate if % Change Over (momentum ≥ %)</span>
                <StrategyTooltip name="minMomentum" />
              </div>
              <div className={fieldWrap + " w-28"}>
                <input
                  type="number"
                  step="any"
                  value={draftMinMomentum}
                  onChange={(e) => setDraftMinMomentum(e.target.value === "" ? "" : +e.target.value)}
                  disabled={disabled}
                  className={inp}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-start sm:justify-end">
              <button
                onClick={confirmBundle}
                disabled={disabled || !draftWallet || draftTokens.length < 2}
                className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50"
              >
                ➕ Confirm Wallet + Tokens
              </button>
            </div>
          </div>

          {/* Existing bundles */}
          {bundles.length > 0 && (
            <div className="mt-4 space-y-2">
              {bundles.map((b) => (
                <div key={b.wallet} className="border border-zinc-700 rounded-lg p-3 bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-indigo-300 font-semibold">{b.wallet}</span>
                    <span className="text-xs text-emerald-400">
                      Price Change ≥ {b.minMomentum ?? 10}%
                    </span>
                    {!disabled && (
                      <button
                        className="text-red-400 hover:text-red-500 text-xs"
                        onClick={() =>
                          setConfig((p) => {
                            const nextBundles = (p.bundles || []).filter((x) => x.wallet !== b.wallet);
                            const stillUsed   = new Set(nextBundles.flatMap((z) => z.tokens));
                            return {
                              ...p,
                              bundles: nextBundles,
                              wallets: nextBundles.map((z) => z.wallet),
                              tokens: [...stillUsed],
                            };
                          })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2">
                    {b.tokens.map((m) => (
                      <span key={m} className="bg-emerald-700/30 px-2 py-0.5 rounded-full text-xs">
                        {mintLabel[m] ?? m.slice(0, 4)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Price-change window */}
          {!showRequiredOnly && (
            <div className="mt-4">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Price-Change Window</span>
                <span className="text-zinc-400 italic text-xs">(momentum look-back)</span>
                <StrategyTooltip name="priceChangeWindow" />
              </div>
              <div className="relative mt-1">
                <div className={fieldWrap}>
                  <select
                    name="priceChangeWindow"
                    value={merged.priceChangeWindow ?? ""}
                    onChange={(e) =>
                      setConfig((p) => ({ ...p, priceChangeWindow: e.target.value }))
                    }
                    disabled={disabled}
                    className={`${inp} appearance-none pr-8`}
                  >
                    <option value="">Auto (match interval)</option>
                    {["5m","10m","30m","1h","2h","4h","8h","24h"].map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>
          )}
        </Card>
      </Section>
    </>
  );

  /* Execution Tab: interval, max, fees */
  const ExecutionTab = () => (
    <Section>
      <Card title="Timing & Limits">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rotation Interval (ms)</span>
              <StrategyTooltip name="rotationInterval" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="rotationInterval"
                value={merged.rotationInterval}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    rotationInterval: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                  }))
                }
                placeholder="e.g. 600000"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Max rotations */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Max Rotations (#)</span>
              <StrategyTooltip name="maxRotations" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="maxRotations"
                value={merged.maxRotations}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    maxRotations: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                  }))
                }
                placeholder="e.g. 50"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      {!showRequiredOnly && (
        <Card title="Fees">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Priority Fee (μlam)</span>
                <StrategyTooltip name="priorityFeeLamports" />
              </div>
              <div className={fieldWrap}>
                <input
                  type="number"
                  name="priorityFeeLamports"
                  value={merged.priorityFeeLamports}
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      priorityFeeLamports: e.target.value === "" ? "" : +e.target.value,
                    }))
                  }
                  disabled={disabled}
                  placeholder="e.g. 20000"
                  className={inp}
                />
              </div>
            </div>
          </div>
        </Card>
      )}
    </Section>
  );

  /* Advanced Tab: cooldown, slippage (max) */
  const AdvancedTab = () => {
    const advFields = customFields ?? [
      { label: "Per-token Cooldown (s)", name: "cooldown" },
      { label: "Max Slippage (%)",       name: "maxSlippage" },
      // priority fee handled in Execution tab
    ];
    return (
      <>
        <Section>
          <Card title="Advanced">
            <AdvancedFields
              config={merged}
              setConfig={setConfig}
              disabled={disabled}
              fields={advFields}
            />
          </Card>
        </Section>
        {children}
      </>
    );
  };

  /* Summary helpers */
  const minutes = (ms) => (ms && !Number.isNaN(+ms) ? Math.round(+ms / 60000) : "—");

  /* Render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs (solid, clipped to rounded corners) */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Rotation Bot Config</h2>

          {/* Pretty toggle */}
          <label className="flex items-center gap-3 select-none">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={showRequiredOnly}
              onChange={(e) => setShowRequiredOnly(e.target.checked)}
            />
            <span className="relative inline-flex h-5 w-9 rounded-full bg-zinc-700 transition-colors peer-checked:bg-emerald-500">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs sm:text-sm text-zinc-300">Required only</span>
          </label>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 relative">
          <TabButton active={activeTab==="core"} onClick={()=>setActiveTab("core")} badge={tabErr.core}>Core</TabButton>
          <TabButton active={activeTab==="execution"} onClick={()=>setActiveTab("execution")} badge={tabErr.execution}>Execution</TabButton>
          <TabButton active={activeTab==="advanced"} onClick={()=>setActiveTab("advanced")} badge={tabErr.advanced}>Advanced</TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          🔄 Rotate capital across wallets into highest-momentum tokens using shared token lists and time windows.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core"      && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "advanced"  && <AdvancedTab />}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs leading-4">
            <span className="text-pink-400 font-semibold">Rotation Summary</span> —&nbsp;
            Interval <span className="text-emerald-300 font-semibold">{minutes(merged.rotationInterval)} min</span>;
            &nbsp;Max <span className="text-emerald-300 font-semibold">{merged.maxRotations}</span> cycles;
            {merged.priorityFeeLamports ? (
              <>; CU fee <span className="text-yellow-300 font-semibold">{merged.priorityFeeLamports} μlam</span></>
            ) : null}
            {merged.priceChangeWindow ? (
              <>; Look-back <span className="text-indigo-300 font-semibold">{merged.priceChangeWindow}</span></>
            ) : (
              <>; Look-back <span className="text-indigo-300 font-semibold">Auto</span></>
            )}
            &nbsp;|&nbsp; Bundles:&nbsp;
            <span className="text-indigo-300 font-semibold">{bundles.length}</span>
            {bundles.length > 0 && (
              <span className="text-zinc-400">
                {" "}- {new Set(bundles.map((b) => b.wallet)).size} wallets /{" "}
                {new Set(bundles.flatMap((b) => b.tokens)).size} tokens
              </span>
            )}
          </p>

          {bundles.length > 0 && (
            <div className="mt-2 text-[11px] text-zinc-300 space-y-1">
              {bundles.slice(0, 4).map((b) => (
                <div key={b.wallet} className="flex justify-between">
                  <span className="text-zinc-400">{b.wallet}</span>
                  <span className="text-emerald-300">≥ {b.minMomentum ?? 10}%</span>
                  <span className="text-indigo-300">{b.tokens.length} tokens</span>
                </div>
              ))}
              {bundles.length > 4 && (
                <div className="text-zinc-500">…and {bundles.length - 4} more</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Footer (no Apply button) */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">
                ⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}
              </span>
            ) : (
              <span className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]">
                Ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...defaults, ...(prev ?? {}) }))}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Reset visible values to defaults (non-destructive merge)"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {/* keep for parity */}}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RotationBotConfig;
