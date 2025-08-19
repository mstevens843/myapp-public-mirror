// src/components/strategies/RotationBotConfig.jsx
// RotationBotConfig.jsx — hoisted tabs, active-field guard, string-controlled inputs
// - Mirrors Breakout "golden reference" structure for stable typing
// - All numeric fields are type="text" with inputMode="decimal"
// - onChange → parent receives raw string (or boolean for checkboxes)
// - onBlur   → coerce numeric fields to number | ""
// - Guard against parent overwrites by tracking the active input
//
// Strategy-specific bundle builder (wallet + tokens) is preserved but made stable.

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import StrategyTooltip   from "./StrategyTooltip";
import { ChevronDown, X } from "lucide-react";
import { useUser }       from "@/contexts/UserProvider";
import { fetchPortfolio } from "@/utils/auth";
import { validateMint }  from "@/utils/api";
import { toast }         from "sonner";
import { saveConfig }    from "@/utils/autobotApi";

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
export const REQUIRED_FIELDS = ["bundles", "rotationInterval", "maxRotations"];
export const OPTIONAL_FIELDS = [
  "priceChangeWindow",
  "cooldown",
  "maxSlippage",
  "priorityFeeLamports",
];

/* numeric fields we edit as raw strings (coerce on blur/save) */
const NUM_FIELDS = [
  "rotationInterval",
  "maxRotations",
  "priorityFeeLamports",
  "cooldown",
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
  if (
    cfg.rotationInterval === "" ||
    cfg.rotationInterval === undefined ||
    Number.isNaN(+cfg.rotationInterval) ||
    +cfg.rotationInterval <= 0
  ) {
    errs.push("rotationInterval must be > 0 ms.");
  }
  if (
    cfg.maxRotations === "" ||
    cfg.maxRotations === undefined ||
    Number.isNaN(+cfg.maxRotations) ||
    +cfg.maxRotations <= 0
  ) {
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
  if (categorized < errors.length) counts.core += errors.length - categorized;
  return counts;
};

/* ───────────────────────────── Hoisted Tabs ───────────────────────────── */
const CoreTab = React.memo(function CoreTab(props) {
  const {
    view,
    disabled,
    showRequiredOnly,
    walletLabels,
    walletBalances,
    tokenMap,
    draftWallet,
    setDraftWallet,
    draftTokens,
    setDraftTokens,
    draftMinMomentum,
    setDraftMinMomentum,
    walletMenuOpen,
    setWalletMenuOpen,
    tokenMenuOpen,
    setTokenMenuOpen,
    menuRef,
    tokenMenuRef,
    loadTokensFor,
    showCustomBox,
    setShowCustomBox,
    customMint,
    setCustomMint,
    checkingMint,
    setCheckingMint,
    mintLabel,
    setConfig,
    handleChange,
  } = props;

  function isValidMintFormat(mint) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");
  }

  const confirmBundle = () => {
    if (!draftWallet || draftTokens.length < 2) return;
    setConfig((p) => ({
      ...p,
      bundles: [
        ...(p?.bundles || []).filter((b) => b.wallet !== draftWallet),
        {
          wallet: draftWallet,
          tokens: draftTokens,
          // coerce minMomentum number once at confirm time
          minMomentum:
            draftMinMomentum === ""
              ? 10
              : Number.isFinite(+draftMinMomentum)
              ? +draftMinMomentum
              : 10,
        },
      ],
    }));
    setDraftWallet("");
    setDraftTokens([]);
    setDraftMinMomentum("");
  };

  return (
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
                  className={`${FIELD_WRAP} w-full flex items-center justify-between text-left`}
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
                  className={`${FIELD_WRAP} w-full flex items-center justify-between text-left`}
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
                  <div className={FIELD_WRAP + " flex-1"}>
                    <input
                      className={INP}
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
              <div className={FIELD_WRAP + " w-28"}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draftMinMomentum}
                  onChange={(e) => setDraftMinMomentum(e.target.value)}
                  disabled={disabled}
                  className={INP}
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
          {Array.isArray(view.bundles) && view.bundles.length > 0 && (
            <div className="mt-4 space-y-2">
              {view.bundles.map((b) => (
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
                <div className={FIELD_WRAP}>
                  <select
                    name="priceChangeWindow"
                    value={view.priceChangeWindow ?? ""}
                    onChange={handleChange}
                    disabled={disabled}
                    className={`${INP} appearance-none pr-8`}
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
});

const ExecutionTab = React.memo(function ExecutionTab({ view, disabled, handleChange, handleBlur }) {
  return (
    <Section>
      <Card title="Timing & Limits">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Interval */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Rotation Interval (ms)</span>
              <StrategyTooltip name="rotationInterval" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="rotationInterval"
                value={view.rotationInterval ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("rotationInterval")}
                placeholder="e.g. 600000"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          {/* Max rotations */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Max Rotations (#)</span>
              <StrategyTooltip name="maxRotations" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="maxRotations"
                value={view.maxRotations ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("maxRotations")}
                placeholder="e.g. 50"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Fees">
        <div className="grid sm:grid-cols-2 gap-4">
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
                onChange={handleChange}
                onBlur={handleBlur("priorityFeeLamports")}
                placeholder="e.g. 20000"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );
});

const AdvancedTab = React.memo(function AdvancedTab({ view, disabled, handleChange, handleBlur }) {
  return (
    <Section>
      <Card title="Advanced">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Per-token Cooldown (s)</span>
              <StrategyTooltip name="cooldown" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="cooldown"
                value={view.cooldown ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("cooldown")}
                placeholder="e.g. 30"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Max Slippage (%)</span>
              <StrategyTooltip name="maxSlippage" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="maxSlippage"
                value={view.maxSlippage ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("maxSlippage")}
                placeholder="e.g. 5"
                disabled={disabled}
                className={INP}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );
});

/* ───────────────────────────── Main Component ───────────────────────────── */
const RotationBotConfig = ({
  config = {},
  setConfig,
  disabled = false,
  children,
  mode = "rotation",
}) => {
  /* defaults */
  const defaults = {
    bundles: [],
    rotationInterval: 600_000, // 10m ms
    maxRotations: 50,
    priceChangeWindow: "", // auto
    cooldown: "",
    maxSlippage: "",
    priorityFeeLamports: "",
  };

  /* Merge defaults with incoming config */
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // Debug flags
  const isDebug =
    typeof window !== "undefined" && localStorage.ROTATION_DEBUG === "1";
  const isRawInputMode =
    typeof window !== "undefined" && localStorage.ROTATION_RAW_INPUT_MODE === "1";

  // Active-field guard
  const activeFieldRef = useRef(null);
  const clearActiveField = useCallback(() => {
    activeFieldRef.current = null;
    if (typeof window !== "undefined") {
      window.__ROTATION_ACTIVE_FIELD = null;
    }
  }, []);

  const handleFocusCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    activeFieldRef.current = name;
    if (typeof window !== "undefined") {
      window.__ROTATION_ACTIVE_FIELD = name;
    }
    logFocus({ comp: "RotationBotConfig", field: name });
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
    logSelection({ comp: "RotationBotConfig", field: name, start, end });
  }, []);

  // Log renders
  useEffect(() => {
    logRender({
      comp: "RotationBotConfig",
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
      setConfig((prev) => {
        const updated = { ...(prev ?? {}) };
        updated[name] = next;
        return updated;
      });
      logChange({
        comp: "RotationBotConfig",
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
      setConfig((prev) => {
        const updated = { ...(prev ?? {}) };
        updated[field] = after;
        return updated;
      });
      logBlur({ comp: "RotationBotConfig", field, before, after });
      clearActiveField();
    },
    [setConfig, merged, isRawInputMode, clearActiveField]
  );

  // View model: numeric values as strings for display
  const view = useMemo(() => {
    const v = { ...merged };
    for (const k of NUM_FIELDS) {
      const val = merged[k];
      v[k] = (val === "" || val === null || val === undefined) ? "" : String(val);
    }
    return v;
  }, [merged]);

  const errors = validateRotationBot(merged);
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
      logEffect({ comp: "RotationBotConfig", reason: "savePreset", touched: patch });
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

  /* ─────────── Wallets/tokens data & drafts (strategy-specific UI) ─────────── */
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

  // cache/load wallet tokens
  const SOL_MINT  = "So11111111111111111111111111111111111111112";
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

  // open/close menus by click-outside
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

  // prewarm caches
  useEffect(() => {
    walletLabels.forEach((w) => loadTokensFor(w.label, w.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletLabels.length]);

  // mint label map
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

  /* Summary helpers */
  const minutes = (ms) => (ms && !Number.isNaN(+ms) ? Math.round(+ms / 60000) : "—");

  /* Header badges & toggle mirror Breakout */
  const summaryBundles = merged.bundles ?? [];

  /* Render */
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
            Rotation Bot Config
            {typeof window !== "undefined" && localStorage.ROTATION_DEBUG === "1" && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-white">Input Debug ON</span>
            )}
            {typeof window !== "undefined" && localStorage.ROTATION_RAW_INPUT_MODE === "1" && (
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
          🔄 Rotate capital across wallets into highest-momentum tokens using shared token lists and time windows.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core" && (
          <CoreTab
            view={view}
            disabled={disabled}
            showRequiredOnly={showRequiredOnly}
            walletLabels={walletLabels}
            walletBalances={walletBalances}
            tokenMap={tokenMap}
            draftWallet={draftWallet}
            setDraftWallet={setDraftWallet}
            draftTokens={draftTokens}
            setDraftTokens={setDraftTokens}
            draftMinMomentum={draftMinMomentum}
            setDraftMinMomentum={setDraftMinMomentum}
            walletMenuOpen={walletMenuOpen}
            setWalletMenuOpen={setWalletMenuOpen}
            tokenMenuOpen={tokenMenuOpen}
            setTokenMenuOpen={setTokenMenuOpen}
            menuRef={menuRef}
            tokenMenuRef={tokenMenuRef}
            loadTokensFor={loadTokensFor}
            showCustomBox={showCustomBox}
            setShowCustomBox={setShowCustomBox}
            customMint={customMint}
            setCustomMint={setCustomMint}
            checkingMint={checkingMint}
            setCheckingMint={setCheckingMint}
            mintLabel={mintLabel}
            setConfig={setConfig}
            handleChange={handleChange}
          />
        )}

        {activeTab === "execution" && (
          <ExecutionTab
            view={view}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
          />
        )}

        {activeTab === "advanced" && (
          <AdvancedTab
            view={view}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
          />
        )}

        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs leading-4">
            <span className="text-pink-400 font-semibold">Rotation Summary</span> —&nbsp;
            Interval <span className="text-emerald-300 font-semibold">{minutes(view.rotationInterval)} min</span>;
            &nbsp;Max <span className="text-emerald-300 font-semibold">{view.maxRotations || "—"}</span> cycles;
            {view.priorityFeeLamports ? (
              <>; CU fee <span className="text-yellow-300 font-semibold">{view.priorityFeeLamports} μlam</span></>
            ) : null}
            {view.priceChangeWindow ? (
              <>; Look-back <span className="text-indigo-300 font-semibold">{view.priceChangeWindow}</span></>
            ) : (
              <>; Look-back <span className="text-indigo-300 font-semibold">Auto</span></>
            )}
            &nbsp;|&nbsp; Bundles:&nbsp;
            <span className="text-indigo-300 font-semibold">{summaryBundles.length}</span>
            {summaryBundles.length > 0 && (
              <span className="text-zinc-400">
                {" "}- {new Set(summaryBundles.map((b) => b.wallet)).size} wallets /{" "}
                {new Set(summaryBundles.flatMap((b) => b.tokens)).size} tokens
              </span>
            )}
          </p>

          {summaryBundles.length > 0 && (
            <div className="mt-2 text-[11px] text-zinc-300 space-y-1">
              {summaryBundles.slice(0, 4).map((b) => (
                <div key={b.wallet} className="flex justify-between">
                  <span className="text-zinc-400">{b.wallet}</span>
                  <span className="text-emerald-300">≥ {b.minMomentum ?? 10}%</span>
                  <span className="text-indigo-300">{b.tokens.length} tokens</span>
                </div>
              ))}
              {summaryBundles.length > 4 && (
                <div className="text-zinc-500">…and {summaryBundles.length - 4} more</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">
                ⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}
              </span>
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
                logEffect({ comp: "RotationBotConfig", reason: "reset", touched: reset });
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

export default RotationBotConfig;
