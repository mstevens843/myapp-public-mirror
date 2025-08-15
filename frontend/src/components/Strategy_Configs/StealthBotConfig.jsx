// StealthBotConfig.jsx — Sniper-style tabbed layout (Core / Execution / Advanced)
// Solid (non-transparent) backgrounds, darker container, pretty toggle, no “Apply” button

import React, { useEffect, useMemo, useState, useRef } from "react";
import StrategyTooltip   from "./StrategyTooltip";
import AdvancedFields    from "../ui/AdvancedFields";
import { X, ChevronDown } from "lucide-react";
import { useUser } from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";
import { authFetch } from "@/utils/authFetch";

/* Validation contracts used by parent */
export const REQUIRED_FIELDS = ["wallets", "tokenMint", "positionSize"];
export const OPTIONAL_FIELDS = [
  "slippage",
  "maxSlippage",
  "priorityFeeLamports",
  "rotationInterval",
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
  core: ["wallets", "tokenMint", "positionSize"],
  execution: ["rotationInterval", "priorityFeeLamports"],
  advanced: ["slippage", "maxSlippage"],
};

/* ───────────────────────────── Validation ───────────────────────────── */
const isValidAddr = (s = "") => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

const validateStealth = (cfg = {}) => {
  const errs = [];
  if (!Array.isArray(cfg.wallets) || cfg.wallets.length === 0) {
    errs.push("wallets must include at least one wallet.");
  }
  if (!cfg.tokenMint || !isValidAddr(cfg.tokenMint)) {
    errs.push("tokenMint must be a valid mint address.");
  }
  if (cfg.positionSize === "" || cfg.positionSize == null || Number.isNaN(+cfg.positionSize) || +cfg.positionSize <= 0) {
    errs.push("positionSize must be > 0 SOL.");
  }
  if (cfg.rotationInterval !== undefined && cfg.rotationInterval !== "" && (+cfg.rotationInterval < 0 || Number.isNaN(+cfg.rotationInterval))) {
    errs.push("rotationInterval must be ≥ 0 ms.");
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
export default function StealthBotConfig({
  config   = {},
  setConfig,
  disabled = false,
  children,
}) {
  const { wallets: walletLabels = [] } = useUser(); // [{id,label,publicKey,…}]
  const SOL_MINT  = "So11111111111111111111111111111111111111112";

  /* defaults */
  const defaults = {
    wallets: [],
    tokenMint: "",
    positionSize: 0.02,       // SOL per wallet
    rotationInterval: 0,      // ms; 0 = once
    slippage: "",
    maxSlippage: "",
    priorityFeeLamports: "",  // μlam
  };
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* backend lookups & caches */
  const [tokenMap, setTokenMap] = useState({});       // label -> tokens[]
  const [walletBalances, setWalletBalances] = useState({}); // label -> { balance, value }
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const loadTokens = async (label, id) => {
    if (!label || tokenMap[label] || !id) return; // already fetched / invalid
    try {
      const tokens = await fetchPortfolio(id);
      if (!Array.isArray(tokens)) throw new Error("Invalid tokens payload");
      setTokenMap((m) => ({ ...m, [label]: tokens }));

      // derive SOL meta for quick display
      const solTok = tokens.find((t) => t.mint === SOL_MINT) || { amount: 0, price: 0 };
      const balance = Number(solTok.amount) || 0;
      const value   = balance * Number(solTok.price || 0);
      setWalletBalances((prev) => ({ ...prev, [label]: { balance, value } }));
    } catch (err) {
      console.warn(`⚠️ Failed to load tokens for ${label}:`, err?.message || err);
    }
  };

  // prewarm visible wallets
  useEffect(() => {
    walletLabels.forEach((w) => loadTokens(w.label, w.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletLabels.length]);

  // ensure selected config wallets are hydrated
  useEffect(() => {
    if (!Array.isArray(merged.wallets)) return;
    merged.wallets.forEach((lbl) => {
      const meta = walletLabels.find((w) => w.label === lbl);
      if (meta?.id) loadTokens(lbl, meta.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged.wallets?.length, walletLabels.length]);

  // click-outside for menu
  useEffect(() => {
    if (!walletMenuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setWalletMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [walletMenuOpen]);

  /* UI state */
  const [selectedWallet, setSelectedWallet] = useState("");
  const [customMint,     setCustomMint]     = useState("");
  const [checking,       setChecking]       = useState(false);

  /* helpers */
  const update = (kv) => setConfig((p) => ({ ...p, ...kv }));
  const mintLabel = useMemo(
    () =>
      Object.fromEntries(
        Object.values(tokenMap)
          .flat()
          .map((t) => [t.mint, t.symbol || t.name || `${t.mint.slice(0, 4)}…`])
      ),
    [tokenMap]
  );

  /* styles */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";
  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  /* validation + badges */
  const errors = validateStealth(merged);
  const tabErr = countErrorsForTab(errors);

  /* tabs */
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* Tabs */
  const CoreTab = () => (
    <Section>
      <Card title="Wallets" right={null}>
        {/* Wallet selector + Add */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-300 flex items-center gap-1">
            <span>Wallets</span>
            <StrategyTooltip name="wallets" />
          </div>

          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setWalletMenuOpen((o) => !o)}
                className={`${fieldWrap} w-full flex items-center justify-between text-left`}
              >
                <span className="text-sm px-1.5">{selectedWallet || "Select wallet…"}</span>
                <ChevronDown className="w-4 h-4 text-zinc-400 mr-1" />
              </button>

              {walletMenuOpen && (
                <div
                  ref={menuRef}
                  className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-md shadow-lg max-h-60 overflow-y-auto"
                >
                  {walletLabels.map((w) => {
                    const { balance = 0, value = 0 } = walletBalances[w.label] || {};
                    return (
                      <div
                        key={w.label}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedWallet(w.label);
                          setWalletMenuOpen(false);
                        }}
                        className={`px-3 py-2 text-sm hover:bg-emerald-700/40 cursor-pointer ${
                          selectedWallet === w.label ? "bg-emerald-700/30" : ""
                        }`}
                      >
                        {w.label} — {balance.toFixed(2)} SOL (${value.toFixed(2)})
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={disabled || !selectedWallet || (merged.wallets || []).includes(selectedWallet)}
              onClick={() => {
                update({ wallets: [...(merged.wallets || []), selectedWallet] });
                const meta = walletLabels.find((w) => w.label === selectedWallet);
                if (meta?.id) loadTokens(selectedWallet, meta.id);
                setSelectedWallet("");
              }}
              className="px-3 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-sm disabled:opacity-40 transition"
            >
              + Add
            </button>
          </div>

          {/* Wallet pills */}
          {merged.wallets?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {merged.wallets.map((label) => {
                const bal = walletBalances[label]?.balance ?? 0;
                const val = walletBalances[label]?.value ?? 0;
                return (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 bg-emerald-700/30 border border-emerald-500/40 text-emerald-100 text-xs pl-3 pr-2 py-1 rounded-full"
                  >
                    <span className="font-semibold">{label}</span>
                    <span className="text-[11px] bg-emerald-800/70 px-1.5 rounded">
                      {bal.toFixed(2)} SOL (${val.toFixed(2)})
                    </span>
                    <button
                      onClick={() => update({ wallets: merged.wallets.filter((v) => v !== label) })}
                      className="ml-1 hover:text-red-400"
                      title="Remove wallet"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card title="Target Token">
        {/* Token mint entry */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-300 flex items-center gap-1">
            <span>Target Token</span>
            <StrategyTooltip name="token" />
          </div>

          <div className="flex gap-2 items-end">
            <div className={fieldWrap + " flex-1"}>
              <input
                className={inp}
                placeholder="Paste mint address"
                value={customMint}
                onChange={(e) => setCustomMint(e.target.value.trim())}
                disabled={disabled}
              />
            </div>
            <button
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm disabled:opacity-50 transition"
              disabled={checking || !isValidAddr(customMint) || disabled}
              onClick={async () => {
                setChecking(true);
                try {
                  await authFetch("/api/wallets/validate-mint", {
                    method: "POST",
                    body: JSON.stringify({ mint: customMint }),
                  });
                  update({ tokenMint: customMint });
                  setCustomMint("");
                } finally {
                  setChecking(false);
                }
              }}
              type="button"
            >
              {checking ? "…" : "Add"}
            </button>
          </div>

          {merged.tokenMint && (
            <span className="inline-flex items-center gap-2 mt-2 bg-indigo-600/20 border border-indigo-400 text-indigo-200 text-xs pl-3 pr-2 py-0.5 rounded-full">
              <span>
                Target&nbsp;Token:&nbsp;
                <strong>{mintLabel[merged.tokenMint] ?? `${merged.tokenMint.slice(0, 4)}…`}</strong>
              </span>
              <button
                className="ml-1 hover:text-red-400 flex-shrink-0"
                onClick={() => update({ tokenMint: "" })}
                title="Remove token"
                type="button"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      </Card>

      <Card title="Spend">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
            <span>Spend per Wallet (SOL)</span>
            <StrategyTooltip name="positionSize" />
          </div>
          <div className={fieldWrap}>
            <input
              type="number"
              step="0.001"
              min="0"
              value={merged.positionSize}
              onChange={(e) => update({ positionSize: e.target.value === "" ? "" : +e.target.value })}
              disabled={disabled}
              className={inp}
              placeholder="e.g. 0.02"
            />
          </div>
        </div>
      </Card>
    </Section>
  );

  const ExecutionTab = () => (
    <Section>
      <Card title="Timing & Fees" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Loop interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Loop Interval (ms)</span>
              <StrategyTooltip name="rotationInterval" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="rotationInterval"
                value={merged.rotationInterval}
                onChange={(e) =>
                  update({ rotationInterval: e.target.value === "" ? "" : parseInt(e.target.value, 10) })
                }
                placeholder="0 = once"
                disabled={disabled}
                className={inp}
              />
            </div>
          </div>

          {/* Priority fee */}
          {!showRequiredOnly && (
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
                    update({ priorityFeeLamports: e.target.value === "" ? "" : +e.target.value })
                  }
                  disabled={disabled}
                  placeholder="e.g. 20000"
                  className={inp}
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields
            config={merged}
            setConfig={setConfig}
            disabled={disabled}
            fields={[
              { label: "Slippage (%)",     name: "slippage" },
              { label: "Max Slippage (%)", name: "maxSlippage" },
            ]}
          />
        </Card>
      </Section>
      {children}
    </>
  );

  /* summary helpers */
  const minutes = (ms) =>
    ms === 0 ? "once" : ms && !Number.isNaN(+ms) ? `${Math.round(+ms / 60000)} min` : "—";

  /* render */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs (solid, clipped to rounded corners) */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Stealth Bot Config</h2>

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
          🥷 Splits a SOL amount across many wallets and buys the <strong>same token</strong> from each to hide total size.
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
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Stealth Summary</span> — Wallets:&nbsp;
            <span className="text-emerald-300 font-semibold">{merged.wallets?.length || 0}</span>;
            &nbsp;Token:&nbsp;
            <span className="text-indigo-300 font-semibold">
              {merged.tokenMint ? (mintLabel[merged.tokenMint] ?? `${merged.tokenMint.slice(0,4)}…`) : "—"}
            </span>;
            &nbsp;Spend&nbsp;per&nbsp;Wallet:&nbsp;
            <span className="text-emerald-300 font-semibold">{merged.positionSize} SOL</span>;
            &nbsp;Loop:&nbsp;
            <span className="text-emerald-300 font-semibold">
              {minutes(merged.rotationInterval)}
            </span>
            {merged.priorityFeeLamports ? (
              <>; CU fee&nbsp;<span className="text-yellow-300 font-semibold">{merged.priorityFeeLamports} μlam</span></>
            ) : null}
            {(merged.slippage || merged.maxSlippage) && (
              <>; Slip&nbsp;
                <span className="text-orange-300 font-semibold">
                  {merged.slippage ?? "—"}
                </span>
                {merged.maxSlippage ? (
                  <> / <span className="text-orange-300 font-semibold">{merged.maxSlippage}</span></>
                ) : null}
                %
              </>
            )}
          </p>
        </div>
      </div>

      {/* Sticky Footer (no Apply button) */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}</span>
            ) : (
              <span className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]">Ready</span>
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
}
