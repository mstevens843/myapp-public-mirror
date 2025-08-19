// src/components/strategies/StealthBotConfig.jsx
// StealthBotConfig.jsx — hoisted tabs, active-field guard, string-controlled inputs
// - Mirrors the Breakout "golden reference" structure for stable typing
// - All numeric fields are type="text" with inputMode="decimal"
// - onChange → parent receives raw string (or boolean for checkboxes)
// - onBlur   → coerce numeric fields to number | ""
// - Guard against parent overwrites by tracking the active input
//
// Strategy-specific pieces preserved: Wallet selection + token mint validation.

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import StrategyTooltip   from "./StrategyTooltip";
import AdvancedFields    from "../ui/AdvancedFields";
import { X, ChevronDown } from "lucide-react";
import { useUser } from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";
import { authFetch } from "@/utils/authFetch";
import { toast } from "sonner";
import { saveConfig } from "@/utils/autobotApi";

// Logging helpers (same instrumentation as Breakout)
import {
  logChange,
  logBlur,
  logEffect,
  logFocus,
  logSelection,
  logRender,
} from "@/dev/inputDebug";

/* ───────────────────── Validation contract ───────────────────── */
export const REQUIRED_FIELDS = ["wallets", "tokenMint", "positionSize"];
export const OPTIONAL_FIELDS = [
  "slippage",
  "maxSlippage",
  "priorityFeeLamports",
  "rotationInterval",
];

/* numeric fields we edit as raw strings (coerce on blur/save) */
const NUM_FIELDS = [
  "positionSize",
  "rotationInterval",
  "priorityFeeLamports",
  "slippage",
  "maxSlippage",
];

/* ───────────────────── Shared UI helpers ───────────────────── */
const FIELD_WRAP =
  "relative rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 hover:border-zinc-600 focus-within:border-emerald-500/70 transition";
const INP =
  "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 outline-none border-none focus:outline-none";

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
    type="button"
    onClick={onClick}
    className={`relative px-3 sm:px-4 py-2 text-sm transition ${
      active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
    }`}
  >
    <span className="pb-1">{children}</span>
    <span
      className={`absolute left-0 right-0 -bottom-[1px] h-[2px] transition ${
        active ? "bg-emerald-400" : "bg-transparent"
      }`}
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
  if (
    cfg.positionSize === "" ||
    cfg.positionSize == null ||
    Number.isNaN(+cfg.positionSize) ||
    +cfg.positionSize <= 0
  ) {
    errs.push("positionSize must be > 0 SOL.");
  }
  if (
    cfg.rotationInterval !== undefined &&
    cfg.rotationInterval !== "" &&
    (+cfg.rotationInterval < 0 || Number.isNaN(+cfg.rotationInterval))
  ) {
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
  if (categorized < errors.length) counts.core += errors.length - categorized;
  return counts;
};

/* ───────────────────────────── Hoisted Tabs ───────────────────────────── */
const CoreTab = React.memo(function CoreTab({
  view,
  disabled,
  walletLabels,
  walletBalances,
  tokenMap,
  walletMenuOpen,
  setWalletMenuOpen,
  menuRef,
  selectedWallet,
  setSelectedWallet,
  customMint,
  setCustomMint,
  checking,
  setChecking,
  setConfig,
  loadTokens,
  mintLabel,
}) {
  const update = (kv) => setConfig((p) => ({ ...(p ?? {}), ...kv }));

  return (
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
                className={`${FIELD_WRAP} w-full flex items-center justify-between text-left`}
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
              disabled={disabled || !selectedWallet || (view.wallets || []).includes(selectedWallet)}
              onClick={() => {
                update({ wallets: [...(view.wallets || []), selectedWallet] });
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
          {view.wallets?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {view.wallets.map((label) => {
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
                      onClick={() => update({ wallets: view.wallets.filter((v) => v !== label) })}
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
            <div className={FIELD_WRAP + " flex-1"}>
              <input
                className={INP}
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
                } catch (e) {
                  toast.error("Mint validation failed");
                } finally {
                  setChecking(false);
                }
              }}
              type="button"
            >
              {checking ? "…" : "Add"}
            </button>
          </div>

          {view.tokenMint && (
            <span className="inline-flex items-center gap-2 mt-2 bg-indigo-600/20 border border-indigo-400 text-indigo-200 text-xs pl-3 pr-2 py-0.5 rounded-full">
              <span>
                Target&nbsp;Token:&nbsp;
                <strong>{mintLabel[view.tokenMint] ?? `${view.tokenMint.slice(0, 4)}…`}</strong>
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
          <div className={FIELD_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              name="positionSize"
              value={view.positionSize ?? ""}
              onChange={view.handleChange}
              onBlur={view.handleBlur("positionSize")}
              disabled={disabled}
              className={INP}
              placeholder="e.g. 0.02"
            />
          </div>
        </div>
      </Card>
    </Section>
  );
});

const ExecutionTab = React.memo(function ExecutionTab({ view, disabled }) {
  return (
    <Section>
      <Card title="Timing & Fees" className="sm:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Loop interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Loop Interval (ms)</span>
              <StrategyTooltip name="rotationInterval" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="rotationInterval"
                value={view.rotationInterval ?? ""}
                onChange={view.handleChange}
                onBlur={view.handleBlur("rotationInterval")}
                placeholder="0 = once"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Priority fee */}
          {!view.__showRequiredOnly && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Priority Fee (μlam)</span>
                <StrategyTooltip name="priorityFeeLamports" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="priorityFeeLamports"
                  value={view.priorityFeeLamports ?? ""}
                  onChange={view.handleChange}
                  onBlur={view.handleBlur("priorityFeeLamports")}
                  disabled={disabled}
                  placeholder="e.g. 20000"
                  className={INP}
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
});

const AdvancedTab = React.memo(function AdvancedTab({ view, setConfig, disabled, children }) {
  return (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields
            config={view}
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
});

/* ───────────────────────────── Main Component ───────────────────────────── */
const StealthBotConfig = ({
  config   = {},
  setConfig,
  disabled = false,
  children,
  mode = "stealth",
}) => {
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

  /* Merge defaults with incoming config */
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // Debug flags
  const isDebug =
    typeof window !== "undefined" && localStorage.STEALTH_DEBUG === "1";
  const isRawInputMode =
    typeof window !== "undefined" && localStorage.STEALTH_RAW_INPUT_MODE === "1";

  // Active-field guard
  const activeFieldRef = useRef(null);
  const clearActiveField = useCallback(() => {
    activeFieldRef.current = null;
    if (typeof window !== "undefined") {
      window.__STEALTH_ACTIVE_FIELD = null;
    }
  }, []);

  const handleFocusCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    activeFieldRef.current = name;
    if (typeof window !== "undefined") {
      window.__STEALTH_ACTIVE_FIELD = name;
    }
    logFocus({ comp: "StealthBotConfig", field: name });
  }, []);

  const handleBlurCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    if (activeFieldRef.current === name) {
      clearActiveField();
    }
  }, [clearActiveField]);

  const handleSelectCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    const { selectionStart: start, selectionEnd: end } = e.target;
    logSelection({ comp: "StealthBotConfig", field: name, start, end });
  }, []);

  // Log renders
  useEffect(() => {
    logRender({
      comp: "StealthBotConfig",
      fieldSet: Object.keys(merged),
      reason: "render",
    });
  }, [merged]);

  // Generic change handler (string for inputs/selects, boolean for checkboxes)
  const handleChange = useCallback(
    (e) => {
      const { name, type, value, checked } = e.currentTarget;
      let next;
      if (type === "checkbox") {
        next = !!checked;
      } else {
        next = value;
      }
      const prevVal = merged[name];
      setConfig((prev) => ({ ...(prev ?? {}), [name]: next }));
      logChange({
        comp: "StealthBotConfig",
        field: name,
        raw: value,
        prev: prevVal,
        next,
      });
    },
    [setConfig, merged]
  );

  // Blur coercion for numeric fields
  const handleBlur = useCallback(
    (field) => (e) => {
      if (!NUM_FIELDS.includes(field)) {
        clearActiveField();
        return;
      }
      const raw = e?.currentTarget?.value ?? "";
      const before = merged[field];
      if (isRawInputMode) {
        clearActiveField();
        return;
      }
      let after;
      if (raw === "") {
        after = "";
      } else {
        const num = Number(raw);
        after = Number.isFinite(num) ? num : "";
      }
      setConfig((prev) => ({ ...(prev ?? {}), [field]: after }));
      logBlur({ comp: "StealthBotConfig", field, before, after });
      clearActiveField();
    },
    [setConfig, merged, isRawInputMode, clearActiveField]
  );

  // View model: numeric values as strings for display
  const view = useMemo(() => {
    const v = { ...merged, handleChange, handleBlur };
    for (const k of NUM_FIELDS) {
      const val = merged[k];
      v[k] = (val === "" || val === null || val === undefined) ? "" : String(val);
    }
    return v;
  }, [merged, handleChange, handleBlur]);

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

  /* UI state passed to CoreTab */
  const [selectedWallet, setSelectedWallet] = useState("");
  const [customMint,     setCustomMint]     = useState("");
  const [checking,       setChecking]       = useState(false);

  const mintLabel = useMemo(
    () =>
      Object.fromEntries(
        Object.values(tokenMap)
          .flat()
          .map((t) => [t.mint, t.symbol || t.name || `${t.mint.slice(0, 4)}…`])
      ),
    [tokenMap]
  );

  const errors = validateStealth(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  // Preset dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");

  const doSavePreset = async () => {
    try {
      const name = (presetName || "").trim();
      // Normalize numeric fields before saving: coerce to numbers when possible
      const patch = {};
      for (const k of NUM_FIELDS) {
        const raw = merged[k];
        if (raw === "" || raw === null || raw === undefined) {
          patch[k] = "";
        } else {
          const num = Number(raw);
          patch[k] = Number.isFinite(num) ? num : "";
        }
      }
      setConfig((prev) => ({ ...(prev ?? {}), ...patch }));
      logEffect({ comp: "StealthBotConfig", reason: "savePreset", touched: patch });
      await saveConfig(mode, { ...merged, ...patch }, name);
      window.dispatchEvent(new CustomEvent("savedConfig:changed", { detail: { mode } }));
      toast.success(name ? `Saved preset “${name}”` : "Preset saved");
      setShowSaveDialog(false);
      setPresetName("");
    } catch (e) {
      toast.error(e?.message || "Failed to save preset");
    }
  };

  // Prevent parent modal close while save dialog open
  useEffect(() => {
    if (showSaveDialog) {
      document.body.dataset.saveOpen = "1";
    } else {
      delete document.body.dataset.saveOpen;
    }
    return () => {
      delete document.body.dataset.saveOpen;
    };
  }, [showSaveDialog]);

  // expose showRequiredOnly into view for tabs
  const viewForTabs = useMemo(() => ({ ...view, __showRequiredOnly: showRequiredOnly }), [view, showRequiredOnly]);

  /* summary helpers */
  const minutes = (ms) =>
    ms === 0 ? "once" : ms && !Number.isNaN(+ms) ? `${Math.round(+ms / 60000)} min` : "—";

  /* render */
  return (
    <div
      className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl"
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onSelectCapture={handleSelectCapture}
    >
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
            Stealth Bot Config
            {typeof window !== "undefined" && localStorage.STEALTH_DEBUG === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-white">Input Debug ON</span>
            )}
            {typeof window !== "undefined" && localStorage.STEALTH_RAW_INPUT_MODE === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-700 text-white">RAW INPUT MODE</span>
            )}
          </h2>

          {/* Required-only toggle */}
          <label className="flex items-center gap-3 select-none">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={showRequiredOnly}
              onChange={(e) => setShowRequiredOnly(e.currentTarget.checked)}
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

        {activeTab === "core" && (
          <CoreTab
            view={viewForTabs}
            disabled={disabled}
            walletLabels={walletLabels}
            walletBalances={walletBalances}
            tokenMap={tokenMap}
            walletMenuOpen={walletMenuOpen}
            setWalletMenuOpen={setWalletMenuOpen}
            menuRef={menuRef}
            selectedWallet={selectedWallet}
            setSelectedWallet={setSelectedWallet}
            customMint={customMint}
            setCustomMint={setCustomMint}
            checking={checking}
            setChecking={setChecking}
            setConfig={setConfig}
            loadTokens={loadTokens}
            mintLabel={mintLabel}
          />
        )}

        {activeTab === "execution" && (
          <ExecutionTab
            view={viewForTabs}
            disabled={disabled}
          />
        )}

        {activeTab === "advanced" && (
          <AdvancedTab
            view={view}
            setConfig={setConfig}
            disabled={disabled}
          >
            {typeof children !== "undefined" ? children : null}
          </AdvancedTab>
        )}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Stealth Summary</span> — Wallets:&nbsp;
            <span className="text-emerald-300 font-semibold">{view.wallets?.length || 0}</span>;
            &nbsp;Token:&nbsp;
            <span className="text-indigo-300 font-semibold">
              {view.tokenMint ? (mintLabel[view.tokenMint] ?? `${view.tokenMint.slice(0,4)}…`) : "—"}
            </span>;
            &nbsp;Spend&nbsp;per&nbsp;Wallet:&nbsp;
            <span className="text-emerald-300 font-semibold">{view.positionSize || "—"} SOL</span>;
            &nbsp;Loop:&nbsp;
            <span className="text-emerald-300 font-semibold">
              {minutes(view.rotationInterval)}
            </span>
            {view.priorityFeeLamports ? (
              <>; CU fee&nbsp;<span className="text-yellow-300 font-semibold">{view.priorityFeeLamports} μlam</span></>
            ) : null}
            {(view.slippage || view.maxSlippage) && (
              <>; Slip&nbsp;
                <span className="text-orange-300 font-semibold">
                  {view.slippage ?? "—"}
                </span>
                {view.maxSlippage ? (
                  <> / <span className="text-orange-300 font-semibold">{view.maxSlippage}</span></>
                ) : null}
                %
              </>
            )}
          </p>
        </div>
      </div>

      {/* Sticky Footer */}
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
              onClick={() => {
                const reset = { ...defaults };
                setConfig((prev) => ({ ...(prev ?? {}), ...reset }));
                logEffect({ comp: "StealthBotConfig", reason: "reset", touched: reset });
              }}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
              title="Reset this section to defaults"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setShowSaveDialog(true)}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-800 hover:border-zinc-700 text-zinc-200"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>

      {/* Save Preset Dialog (Radix) */}
      <Dialog.Root open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fadeIn" />
          <Dialog.Content
            className="fixed z-50 top-1/2 left-1/2 w-[380px] -translate-x-1/2 -translate-y-1/2
                       rounded-xl border border-zinc-800 bg-zinc-950/95
                       p-5 text-zinc-200 shadow-2xl focus:outline-none
                       data-[state=open]:animate-scaleIn"
          >
            {/* Header */}
            <div className="relative mb-4">
              <Dialog.Title className="text-sm font-semibold text-white text-center">Save Config Preset</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute top-2 right-2 p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            {/* Input */}
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.currentTarget.value)}
              placeholder="Preset name (optional)…"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2
                         text-sm text-white placeholder:text-zinc-500
                         focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            {/* Footer */}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-md border border-zinc-800
                             bg-zinc-900 hover:bg-zinc-800 text-zinc-200"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={doSavePreset}
                className="px-3 py-1.5 text-xs rounded-md bg-emerald-600
                           hover:bg-emerald-500 text-black font-semibold"
              >
                Save
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default StealthBotConfig;
