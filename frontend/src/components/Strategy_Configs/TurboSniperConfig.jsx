// frontend/src/components/Strategy_Configs/TurboSniperConfig.jsx
// TurboSniperConfig.jsx — Concept 1 Tabbed Layout (dark, sleek, card grid)
// - Keeps ALL original fields/logic but reorganizes into tabs:
//   Core • Execution • Risk & Safety • Exits • Advanced
// - Sticky header nav, emerald accent underline on active tab
// - Card-based sections; required-only badge + per-tab error counts
// - Sticky footer with Reset / Safe Turbo / Apply hooks
//
// NOTE: This component is UI-only; wire onApply/onSavePreset/onClose from parent if desired.
//       If not provided, buttons are safe no-ops.

import React, { useMemo, useState } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";
import validateTurboSniperConfig from "./validators/turboSniperValidator";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",       label: "New listings" },
  { value: "trending",  label: "Trending tokens" },
  { value: "high-liquidity", label: "High Liquidity" },
  { value: "mid-cap-growth", label: "Mid-Cap Growth" },
  { value: "price-surge", label: "Price Surge" },
  { value: "volume-spike", label: "Volume Spike" },
  { value: "high-trade", label: "High Trade Count" },
  { value: "recent-good-liquidity", label: "Recently Listed + Liquidity" },
  { value: "all",       label: "All tokens (premium)" },
  { value: "monitored", label: "My Monitored" },
];

/* fields surfaced in Advanced / Summary -------------------------------- */
export const OPTIONAL_FIELDS = [
  "priceWindow", "volumeWindow",
  "minTokenAgeMinutes", "maxTokenAgeMinutes",
  "minMarketCap", "maxMarketCap",
  "tokenFeed", "monitoredTokens", "overrideMonitored",
  // turbo / risk
  "turboMode", "autoRiskManage", "privateRpcUrl",
  // jito / fees
  "useJitoBundle", "jitoTipLamports", "jitoRelayUrl", "autoPriorityFee",
  // jito tuning
  "bundleStrategy", "cuAdapt", "cuPriceMicroLamportsMin", "cuPriceMicroLamportsMax", "tipCurve",
  // rpc / safety
  "rpcEndpoints", "rpcMaxErrors", "killSwitch", "killThreshold", "poolDetection",
  // dex prefs / split / exits
  "allowedDexes", "excludedDexes", "splitTrade", "tpLadder", "trailingStopPct",
  // direct amm
  "directAmmFallback", "directAmmFirstPct", "skipPreflight",
  // post-buy watcher
  "postBuyWatch",
  // iceberg & impact
  "iceberg", "impactAbortPct", "dynamicSlippageMaxPct",
  // new (exposed but summarized elsewhere)
  "leaderTiming", "quoteTtlMs", "retryPolicy", "idempotencyTtlSec",
  "parallelWallets", "pumpfun", "airdrops",
  // risk alpha extensions
  "devWatch", "feeds", "slippageAuto", "postTx",

  // -------------------------------------------
  // Custom heuristics and risk controls
  "enableInsiderHeuristics",
  "maxHolderPercent",
  "requireFreezeRevoked",
  "enableLaserStream",
  "multiWallet",
  "alignToLeader",
  "cuPriceCurve",
  "tipCurveCoefficients",
  "riskLevels",
  "stopLossPercent",
  "postBuyWatch.rugDelayBlocks",

  // -------------------------------------------
  // NEW: Flat Smart Exit + LP Gate fields (required by current validator)
  "smartExitMode",
  "smartExitTimeMins",
  "smartVolLookbackSec",
  "smartVolThreshold",
  "smartLiqLookbackSec",
  "smartLiqDropPct",
  "minPoolUsd",
  "maxPriceImpactPct",
];

/* fields required by validator ---------------------------------------- */
export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

/* Small helpers UI ----------------------------------------------------- */
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
      ${active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}
    `}
  >
    <span className="pb-1">{children}</span>
    <span
      className={`absolute left-0 right-0 -bottom-[1px] h-[2px] transition
        ${active ? "bg-emerald-400" : "bg-transparent"}
      `}
    />
    {badge > 0 && (
      <span className="ml-2 inline-flex items-center justify-center text-[10px] rounded-full px-1.5 py-0.5 bg-red-600/80 text-white">
        {badge}
      </span>
    )}
  </button>
);

/* Map errors to tabs so we can show little red counts on the nav ------- */
/* Heuristic: if an error mentions one of these keys, attribute it. */
const TAB_KEYS = {
  core: [
    "entryThreshold", "priceWindow", "volumeThreshold", "volumeWindow",
    "minTokenAgeMinutes", "maxTokenAgeMinutes",
    "minMarketCap", "maxMarketCap",
    "smartExitMode", "smartExitTimeMins", "smartVolLookbackSec", "smartVolThreshold",
    "smartLiqLookbackSec", "smartLiqDropPct",
    "minPoolUsd", "maxPriceImpactPct"
  ],
  execution: [
    "turboMode", "autoRiskManage", "privateRpcUrl",
    "useJitoBundle", "autoPriorityFee", "bundleStrategy",
    "cuAdapt", "cuPriceMicroLamportsMin", "cuPriceMicroLamportsMax", "tipCurve",
    "leaderTiming", "quoteTtlMs", "idempotencyTtlSec",
    "directAmmFallback", "directAmmFirstPct", "skipPreflight",
    "multiBuy", "multiBuyCount", "prewarmAccounts", "multiRoute",
    "ghostMode", "coverWalletId",
  ],
  risk: [
    "killSwitch", "killThreshold", "poolDetection",
    "impactAbortPct", "dynamicSlippageMaxPct",
    "enableInsiderHeuristics", "maxHolderPercent", "requireFreezeRevoked", "enableLaserStream",
    "alignToLeader", "stopLossPercent",
    "iceberg", "iceberg.tranches", "iceberg.trancheDelayMs",
  ],
  exits: [
    "tpLadder", "trailingStopPct",
    "postBuyWatch", "postBuyWatch.durationSec", "postBuyWatch.lpPullExit", "postBuyWatch.authorityFlipExit",
    "postBuyWatch.rugDelayBlocks",
    // smartExit fields are also referenced on Core (we keep controls in Exits too),
  ],
  advanced: [
    "rpcEndpoints", "rpcMaxErrors", "allowedDexes", "excludedDexes", "splitTrade",
    "retryPolicy", "retryPolicy.max", "retryPolicy.bumpCuStep", "retryPolicy.bumpTipStep",
    "retryPolicy.routeSwitch", "retryPolicy.rpcFailover",
    "parallelWallets", "parallelWallets.walletIds", "parallelWallets.splitPct", "parallelWallets.maxParallel",
    "privateRelay", "idempotency", "sizing", "probe", "airdrops", "pumpfun",
    "feeds", "slippageAuto", "postTx", "airdrop", "pumpfun.cooldownSec",
  ],
    tokenlist: ["tokenFeed", "monitoredTokens", "overrideMonitored"],

};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
const counts = { core: 0, execution: 0, risk: 0, exits: 0, advanced: 0, tokenlist: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) => keys.some((k) => msg.includes(k.toLowerCase()))).length;
  }
  // Any uncategorized errors → Core by default so they aren't “lost”
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += (errors.length - categorized);
  return counts;
};

const TurboSniperConfig = ({
  config = {},
  setConfig,
  disabled,
  children,
  onApply = () => {},
  onSavePreset = () => {},
  onClose = () => {},
}) => {
  /* sensible defaults (mirror Sniper, plus turbo toggles) */
  const defaults = {
    entryThreshold       : 3,
    volumeThreshold      : 50_000,
    priceWindow          : "1h",
    volumeWindow         : "24h",
    tokenFeed            : "new",
    monitoredTokens      : "",
    overrideMonitored    : false,

    minTokenAgeMinutes   : "",
    maxTokenAgeMinutes   : "",
    minMarketCap         : "",
    maxMarketCap         : "",

    dipThreshold         : "",
    delayBeforeBuyMs     : "",
    priorityFeeLamports  : "",

    // MEV prefs
    mevMode              : "fast",     // or "secure"
    briberyAmount        : 0.002,      // SOL

    // Advanced sniper flags
    ghostMode            : false,
    coverWalletId        : "",
    multiBuy             : false,
    multiBuyCount        : 2,
    prewarmAccounts      : false,
    multiRoute           : false,
    autoRug              : false,

    // Premium / execution flags
    useJitoBundle        : false,
    autoPriorityFee      : false,
    jitoTipLamports      : "",
    jitoRelayUrl         : "",
    poolDetection        : false,

    // Safety
    killSwitch           : false,
    killThreshold        : 3,

    // RPC
    rpcEndpoints         : "",
    rpcMaxErrors         : 3,

    // DEX prefs
    allowedDexes         : "",
    excludedDexes        : "",
    splitTrade           : false,

    // Exit helpers
    tpLadder             : "",  // e.g. "25,25,50"
    trailingStopPct      : "",

    // Turbo-specific
    turboMode            : false,
    autoRiskManage       : false,
    privateRpcUrl        : "",

    // Bundle / CU tuning (available regardless of Jito usage)
    bundleStrategy       : "topOfBlock",
    cuAdapt              : false,
    cuPriceMicroLamportsMin: "",
    cuPriceMicroLamportsMax: "",
    tipCurve             : "flat",

    // Leader timing (new)
    leaderTiming         : {
      enabled    : false,
      preflightMs: 220,
      windowSlots: 2,
    },

    // Quote cache + idempotency (new)
    quoteTtlMs           : 600,
    idempotencyTtlSec    : 60,

    // Retry policy (new)
    retryPolicy          : {
      max         : 3,
      bumpCuStep  : 2000,
      bumpTipStep : 1000,
      routeSwitch : true,
      rpcFailover : true,
    },

    // Parallel wallets (new)
    parallelWallets      : {
      enabled    : false,
      walletIds  : [],
      splitPct   : [0.5, 0.5],
      maxParallel: 2,
    },

    // Pump.fun listener (new)
    pumpfun              : {
      enabled       : false,
      thresholdPct  : 0.55,
      minSolLiquidity: 10,
      cooldownSec   : 120,
    },

    // Airdrop sniffer (new)
    airdrops            : {
      enabled            : false,
      autoSell           : true,
      whitelistMints     : [],
      minUsdValue        : 5,
      maxSellSlippagePct : 1.0,
    },

    // Direct AMM fallback
    directAmmFallback    : false,
    directAmmFirstPct    : 0.3,
    skipPreflight        : true,

    // Post-buy watcher defaults
    postBuyWatch         : {
      durationSec: 180,
      lpPullExit: true,
      authorityFlipExit: true,
      rugDelayBlocks: 0,
    },

    // Smart exit configuration (legacy nested – kept for back-compat)
    smartExitMode       : "", // Off | "time" | "volume" | "liquidity"

    smartExit           : {
      time: {
        maxHoldSec: "",
        minPnLBeforeTimeExitPct: "",
      },
      volume: {
        volWindowSec: "",
        volDropPct: "",
      },
      liquidity: {
        lpOutflowExitPct: "",
      },
    },

    // NEW: Flat Smart Exit fields (validator expects these)
    smartExitTimeMins     : "",
    smartVolLookbackSec   : "",
    smartVolThreshold     : "",
    smartLiqLookbackSec   : "",
    smartLiqDropPct       : "",

    // LP Gate (legacy nested – kept)
    liqGate             : {
      minPoolUsd: "",
      maxImpactPctAtLarge: "",
      liqProbeSmallSol: "",
      liqProbeLargeSol: "",
    },

    // NEW: Flat LP Gate fields (validator expects these)
    minPoolUsd          : "",
    maxPriceImpactPct   : "",

    // Iceberg & impact guard
    iceberg              : {
      enabled: false,
      tranches: 1,
      trancheDelayMs: 0,
    },
    impactAbortPct       : "",
    dynamicSlippageMaxPct: "",

    // Developer/creator heuristics
    devWatch: {
      whitelist: [],
      blacklist: [],
      holderTop5MaxPct: 65,
      lpBurnMinPct: 50,
    },

    // Experimental controls...
    enableInsiderHeuristics: false,
    maxHolderPercent: 65,
    requireFreezeRevoked: false,
    enableLaserStream: false,
    multiWallet: 1,
    alignToLeader: false,
    cuPriceCurve: "",
    tipCurveCoefficients: "",
    riskLevels: "",
    stopLossPercent: "",
    rugDelayBlocks: "",

    feeds: {
      order: ["ws", "birdeye", "onchain"],
      ttlMs: 800,
      timeoutMs: 400,
    },

    slippageAuto: {
      enabled: true,
      floorPct: 0.5,
      ceilPct: 2.0,
      sensitivity: 0.6,
    },

    postTx: {
      chain: ["tp", "trail", "alerts"],
      ensureQueued: true,
    },

    // Extra sections
    privateRelay: {
      enabled: false,
      urls: [],
      mode: "bundle", // "bundle" or "tx"
    },
    idempotency: {
      ttlSec: 90,
      salt: "",
      resumeFromLast: true,
    },
    sizing: {
      maxImpactPct: 1.2,
      maxPoolPct: 0.8,
      minUsd: 50,
    },
    probe: {
      enabled: false,
      usd: 5,
      scaleFactor: 4,
      abortOnImpactPct: 2.0,
      delayMs: 250,
    },
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* helper to update nested sections (privateRelay/idempotency/sizing/probe/etc.) */
  const onChangeSection = (parent, child, value) => {
    setConfig((prev) => ({
      ...prev,
      [parent]: {
        ...(prev[parent] ?? defaults[parent] ?? {}),
        [child]: value,
      },
    }));
  };

  /* generic change handler */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setConfig((prev) => ({
        ...prev,
        [parent]: {
          ...(prev[parent] ?? defaults[parent]),
          [child]:
            type === 'checkbox'
              ? checked
              : value === ''
              ? ''
              : isNaN(Number(value)) ? value : parseFloat(value),
        },
      }));
      return;
    }
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : [
              "priceWindow",
              "volumeWindow",
              "recoveryWindow",
              "coverWalletId",
              "rpcEndpoints",
              "allowedDexes",
              "excludedDexes",
              "tpLadder",
              "jitoRelayUrl",
              "privateRpcUrl",
              "tipCurve",
              "bundleStrategy",
              "smartExitMode",
              "cuPriceCurve",
              "tipCurveCoefficients",
              "riskLevels",
            ].includes(name)
          ? value
          : value === "" ? "" : (isNaN(Number(value)) ? value : parseFloat(value)),
    }));
  };

  // Apply a conservative Safe Turbo preset (non-destructive merge)
  const applySafePreset = () => {
    const safe = {
      slippage: 1.0,
      quoteTtlMs: 600,
      idempotencyTtlSec: 60,
      idempotency: {
        ...(merged.idempotency ?? {}),
        ttlSec: 60,
        salt: merged.idempotency?.salt || "auto",
        resumeFromLast: true,
      },
      retryPolicy: {
        ...(merged.retryPolicy ?? {}),
        max: 3,
        bumpCuStep: 2000,
        bumpTipStep: 1000,
        routeSwitch: true,
        rpcFailover: true,
      },
      autoPriorityFee: false,
      parallelWallets: { ...(merged.parallelWallets ?? {}), enabled: false },
    };
    setConfig((prev) => ({ ...prev, ...safe }));
  };

  /* select options */
  const priceWins  = ["", "1m","5m","30m","1h","2h","4h","6h"];
  const volumeWins = ["", "1m","5m","30m","1h","4h","8h","24h"];

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  // Validations & tab error badges
  const errors = validateTurboSniperConfig(merged) || [];
  const tabErr = countErrorsForTab(errors);

  // Local UI state
  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* ---------- Tab content renderers (cards per tab) ------------------- */

  const CoreTab = () => (
    <Section>
      {/* Core Filters */}
      <Card title="Core Filters">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Pump Threshold (%) <StrategyTooltip name="entryThreshold" />
            </span>
            <input
              type="number"
              name="entryThreshold"
              step="any"
              value={merged.entryThreshold}
              onChange={change}
              placeholder="e.g. 3"
              className={inp}
              disabled={disabled}
            />
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Pump Time Window <StrategyTooltip name="priceWindow" />
            </span>
            <div className="relative">
              <select
                name="priceWindow"
                value={merged.priceWindow}
                onChange={change}
                className={`${inp} appearance-none pr-10`}
                disabled={disabled}
              >
                <option value="">None</option>
                {priceWins.map((w) => <option key={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
            </div>
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Volume Floor (USD) <StrategyTooltip name="volumeThreshold" />
            </span>
            <input
              type="number"
              name="volumeThreshold"
              value={merged.volumeThreshold}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 50000"
              className={inp}
            />
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Volume Time Window <StrategyTooltip name="volumeWindow" />
            </span>
            <div className="relative">
              <select
                name="volumeWindow"
                value={merged.volumeWindow}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-10`}
              >
                <option value="">None</option>
                {volumeWins.map((w) => <option key={w}>{w}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
            </div>
          </label>
        </div>

        {/* Token age / market cap (folded under Core as in concept density) */}
        {!showRequiredOnly && (
          <>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              {["min","max"].map((k) => (
                <label key={k} className="flex flex-col text-sm font-medium gap-1">
                  <span className="flex items-center gap-1">
                    {k === "min" ? "Min" : "Max"} Token Age (min)
                    <StrategyTooltip name={`${k}TokenAgeMinutes`} />
                  </span>
                  <input
                    type="number"
                    name={`${k}TokenAgeMinutes`}
                    value={merged[`${k}TokenAgeMinutes`] ?? ""}
                    onChange={change}
                    disabled={disabled}
                    placeholder="e.g. 60"
                    className={inp}
                  />
                </label>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Min Market Cap (USD) <StrategyTooltip name="minMarketCap" />
                </span>
                <input
                  type="number"
                  name="minMarketCap"
                  value={merged.minMarketCap ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 1000000"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Max Market Cap (USD) <StrategyTooltip name="maxMarketCap" />
                </span>
                <input
                  type="number"
                  name="maxMarketCap"
                  value={merged.maxMarketCap ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 10000000"
                  className={inp}
                />
              </label>
            </div>
          </>
        )}
      </Card>

      {/* LP Gate */}
      <Card title="LP Gate">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span>Min Pool USD</span>
            <input
              type="number"
              name="minPoolUsd"
              min="0"
              step="1"
              value={merged.minPoolUsd ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 2500"
              className={inp}
            />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            <span>Max Price Impact (%)</span>
            <input
              type="number"
              name="maxPriceImpactPct"
              min="0"
              max="100"
              step="0.1"
              value={merged.maxPriceImpactPct ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 5"
              className={inp}
            />
          </label>

          {/* Advanced (legacy) */}
          {!showRequiredOnly && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Min Pool USD — advanced</span>
                <input
                  type="number"
                  name="liqGate.minPoolUsd"
                  min="0"
                  value={merged.liqGate?.minPoolUsd ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 10000"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Max Impact @ Large % — advanced</span>
                <input
                  type="number"
                  name="liqGate.maxImpactPctAtLarge"
                  min="0"
                  max="100"
                  value={merged.liqGate?.maxImpactPctAtLarge ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 50"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Small Probe (SOL) — advanced</span>
                <input
                  type="number"
                  name="liqGate.liqProbeSmallSol"
                  min="0"
                  value={merged.liqGate?.liqProbeSmallSol ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 0.1"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Large Probe (SOL) — advanced</span>
                <input
                  type="number"
                  name="liqGate.liqProbeLargeSol"
                  min="0"
                  value={merged.liqGate?.liqProbeLargeSol ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 1"
                  className={inp}
                />
              </label>
            </>
          )}
        </div>
      </Card>

      {/* Quick Toggles */}
      <Card title="Quick Toggles">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="turboMode"
              checked={!!merged.turboMode}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Turbo Mode <StrategyTooltip name="turboMode" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="autoRiskManage"
              checked={!!merged.autoRiskManage}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Auto Risk Manage <StrategyTooltip name="autoRiskManage" />
          </label>
        </div>
      </Card>
    </Section>
  );

  const ExecutionTab = () => (
    <Section>
      <Card title="Execution">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Bundle Strategy */}
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Bundle Strategy <StrategyTooltip name="bundleStrategy" />
            </span>
            <select
              name="bundleStrategy"
              value={merged.bundleStrategy || "topOfBlock"}
              onChange={change}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              <option value="topOfBlock">topOfBlock</option>
              <option value="backrun">backrun</option>
              <option value="private">private</option>
            </select>
          </label>

          {/* Private RPC */}
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Private RPC URL <StrategyTooltip name="privateRpcUrl" />
            </span>
            <input
              type="text"
              name="privateRpcUrl"
              value={merged.privateRpcUrl ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="https://example-rpc"
              className={inp}
            />
          </label>

          {/* Leader timing toggle */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="leaderTiming.enabled"
              checked={!!merged.leaderTiming?.enabled}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Leader Timing (pre-slot fire) <StrategyTooltip name="leaderTiming" />
          </label>

          {merged.leaderTiming?.enabled && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Preflight (ms) <StrategyTooltip name="leaderTiming.preflightMs" />
                </span>
                <input
                  type="number"
                  name="leaderTiming.preflightMs"
                  value={merged.leaderTiming?.preflightMs ?? 220}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Window Slots <StrategyTooltip name="leaderTiming.windowSlots" />
                </span>
                <input
                  type="number"
                  name="leaderTiming.windowSlots"
                  value={merged.leaderTiming?.windowSlots ?? 2}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
            </>
          )}

          {/* TTLs */}
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Quote TTL (ms) <StrategyTooltip name="quoteTtlMs" />
            </span>
            <input
              type="number"
              name="quoteTtlMs"
              value={merged.quoteTtlMs ?? 600}
              onChange={change}
              disabled={disabled}
              className={inp}
            />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Idempotency TTL (sec) <StrategyTooltip name="idempotencyTtlSec" />
            </span>
            <input
              type="number"
              name="idempotencyTtlSec"
              value={merged.idempotencyTtlSec ?? 60}
              onChange={change}
              disabled={disabled}
              className={inp}
            />
          </label>
        </div>
      </Card>

      <Card title="Jito & Fees">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="useJitoBundle"
              checked={!!merged.useJitoBundle}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Use Jito Bundle <StrategyTooltip name="useJitoBundle" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="autoPriorityFee"
              checked={!!merged.autoPriorityFee}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Auto Priority Fee <StrategyTooltip name="autoPriorityFee" />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="cuAdapt"
              checked={!!merged.cuAdapt}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Adaptive CU Price <StrategyTooltip name="cuAdapt" />
          </label>

          {merged.cuAdapt && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  CU Price Min (µLAM) <StrategyTooltip name="cuPriceMicroLamportsMin" />
                </span>
                <input
                  type="number"
                  name="cuPriceMicroLamportsMin"
                  value={merged.cuPriceMicroLamportsMin ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 100"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  CU Price Max (µLAM) <StrategyTooltip name="cuPriceMicroLamportsMax" />
                </span>
                <input
                  type="number"
                  name="cuPriceMicroLamportsMax"
                  value={merged.cuPriceMicroLamportsMax ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 1000"
                  className={inp}
                />
              </label>
            </>
          )}

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Tip Curve <StrategyTooltip name="tipCurve" />
            </span>
            <select
              name="tipCurve"
              value={merged.tipCurve || "flat"}
              onChange={change}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              <option value="flat">flat</option>
              <option value="ramp">ramp</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Direct AMM & Parallelization">
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Direct AMM */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="directAmmFallback"
              checked={!!merged.directAmmFallback}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Direct AMM Fallback <StrategyTooltip name="directAmmFallback" />
          </label>
          {merged.directAmmFallback && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  First AMM Fraction (0–1) <StrategyTooltip name="directAmmFirstPct" />
                </span>
                <input
                  type="number"
                  name="directAmmFirstPct"
                  min="0"
                  max="1"
                  step="0.01"
                  value={merged.directAmmFirstPct ?? 0.3}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="skipPreflight"
                  checked={!!merged.skipPreflight}
                  onChange={change}
                  disabled={disabled}
                  className="accent-emerald-500"
                />
                Skip Preflight <StrategyTooltip name="skipPreflight" />
              </label>
            </>
          )}

          {/* Parallel wallets */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="parallelWallets.enabled"
              checked={!!merged.parallelWallets?.enabled}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Enable Parallel Filler <StrategyTooltip name="parallelWallets" />
          </label>

          {merged.parallelWallets?.enabled && (
            <div className="sm:col-span-2 grid sm:grid-cols-3 gap-4">
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Wallet IDs (comma) <StrategyTooltip name="parallelWallets.walletIds" />
                </span>
                <input
                  type="text"
                  value={(merged.parallelWallets?.walletIds ?? []).join(",")}
                  onChange={(e) => {
                    const ids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    setConfig((prev) => ({
                      ...prev,
                      parallelWallets: {
                        ...(prev.parallelWallets ?? defaults.parallelWallets),
                        walletIds: ids,
                      },
                    }));
                  }}
                  disabled={disabled}
                  placeholder="id1,id2"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Split Pct (comma) <StrategyTooltip name="parallelWallets.splitPct" />
                </span>
                <input
                  type="text"
                  value={(merged.parallelWallets?.splitPct ?? [0.5,0.5]).join(",")}
                  onChange={(e) => {
                    const parts = e.target.value
                      .split(',')
                      .map((s) => parseFloat(s.trim()))
                      .filter((n) => Number.isFinite(n));
                    setConfig((prev) => ({
                      ...prev,
                      parallelWallets: {
                        ...(prev.parallelWallets ?? defaults.parallelWallets),
                        splitPct: parts,
                      },
                    }));
                  }}
                  disabled={disabled}
                  placeholder="0.5,0.5"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Max Parallel <StrategyTooltip name="parallelWallets.maxParallel" />
                </span>
                <input
                  type="number"
                  name="parallelWallets.maxParallel"
                  value={merged.parallelWallets?.maxParallel ?? 2}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
            </div>
          )}
        </div>
      </Card>

      <Card title="Advanced Execution Flags">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="ghostMode"
              checked={!!merged.ghostMode}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Ghost Mode (forward to cover) <StrategyTooltip name="ghostMode" />
          </label>
          {merged.ghostMode && (
            <input
              type="text"
              name="coverWalletId"
              value={merged.coverWalletId || ""}
              onChange={change}
              disabled={disabled}
              placeholder="Cover wallet ID"
              className={inp}
            />
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="multiBuy"
              checked={!!merged.multiBuy}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Parallel Multi-Buy <StrategyTooltip name="multiBuy" />
          </label>
          {merged.multiBuy && (
            <input
              type="number"
              name="multiBuyCount"
              min="1"
              max="3"
              value={merged.multiBuyCount}
              onChange={change}
              disabled={disabled}
              placeholder="Count (1–3)"
              className={inp}
            />
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="prewarmAccounts"
              checked={!!merged.prewarmAccounts}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Pre-Warm Accounts <StrategyTooltip name="prewarmAccounts" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="autoRug"
              checked={!!merged.autoRug}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Auto Rug Detection <StrategyTooltip name="autoRug" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="multiRoute"
              checked={!!merged.multiRoute}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Multi-Route Aggregation <StrategyTooltip name="multiRoute" />
          </label>
        </div>
      </Card>
    </Section>
  );

  const RiskTab = () => (
    <Section>
      <Card title="Risk & Safety">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="killSwitch"
              checked={!!merged.killSwitch}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Kill Switch <StrategyTooltip name="killSwitch" />
          </label>
          {merged.killSwitch && (
            <input
              type="number"
              name="killThreshold"
              min="1"
              value={merged.killThreshold ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="Fails threshold"
              className={inp}
            />
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="poolDetection"
              checked={!!merged.poolDetection}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Pool Detection <StrategyTooltip name="poolDetection" />
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Impact Abort (%) <StrategyTooltip name="impactAbortPct" />
            </span>
            <input
              type="number"
              name="impactAbortPct"
              min="0"
              value={merged.impactAbortPct ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 3"
              className={inp}
            />
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Max Dynamic Slippage (%) <StrategyTooltip name="dynamicSlippageMaxPct" />
            </span>
            <input
              type="number"
              name="dynamicSlippageMaxPct"
              min="0"
              value={merged.dynamicSlippageMaxPct ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 2"
              className={inp}
            />
          </label>
        </div>
      </Card>

      <Card title="Detection & Heuristics">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enableInsiderHeuristics"
              checked={!!merged.enableInsiderHeuristics}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Insider Heuristics <StrategyTooltip name="enableInsiderHeuristics" />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Max Holder % <StrategyTooltip name="maxHolderPercent" />
            </span>
            <input
              type="number"
              name="maxHolderPercent"
              min="0"
              max="100"
              value={merged.maxHolderPercent ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 65"
              className={inp}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requireFreezeRevoked"
              checked={!!merged.requireFreezeRevoked}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Require Freeze Revoked <StrategyTooltip name="requireFreezeRevoked" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enableLaserStream"
              checked={!!merged.enableLaserStream}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Laser Stream <StrategyTooltip name="enableLaserStream" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="alignToLeader"
              checked={!!merged.alignToLeader}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Align to Leader <StrategyTooltip name="alignToLeader" />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Stop Loss (%) <StrategyTooltip name="stopLossPercent" />
            </span>
            <input
              type="number"
              name="stopLossPercent"
              min="0"
              max="100"
              value={merged.stopLossPercent ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 50"
              className={inp}
            />
          </label>
        </div>
      </Card>

      <Card title="Iceberg Entries">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="iceberg.enabled"
              checked={!!merged.iceberg?.enabled}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Iceberg Entries <StrategyTooltip name="iceberg" />
          </label>
          {merged.iceberg?.enabled && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Tranches <StrategyTooltip name="iceberg.tranches" />
                </span>
                <input
                  type="number"
                  name="iceberg.tranches"
                  min="1"
                  value={merged.iceberg?.tranches ?? 1}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span className="flex items-center gap-1">
                  Tranche Delay (ms) <StrategyTooltip name="iceberg.trancheDelayMs" />
                </span>
                <input
                  type="number"
                  name="iceberg.trancheDelayMs"
                  min="0"
                  value={merged.iceberg?.trancheDelayMs ?? 0}
                  onChange={change}
                  disabled={disabled}
                  className={inp}
                />
              </label>
            </>
          )}
        </div>
      </Card>
    </Section>
  );

  const ExitsTab = () => (
    <Section>
      <Card title="Smart Exit">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Smart Exit Mode <StrategyTooltip name="smartExitMode" />
            </span>
            <select
              name="smartExitMode"
              value={merged.smartExitMode ?? ""}
              onChange={change}
              disabled={disabled}
              className={inp}
            >
              <option value="">Off</option>
              <option value="time">Time</option>
              <option value="volume">Volume</option>
              <option value="liquidity">Liquidity</option>
            </select>
          </label>

          {/* Flat required-by-validator fields */}
          {merged.smartExitMode === 'time' && (
            <label className="flex flex-col text-sm font-medium gap-1">
              <span>Time (minutes)</span>
              <input
                type="number"
                name="smartExitTimeMins"
                min={1}
                max={1440}
                value={merged.smartExitTimeMins ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 30"
                className={inp}
              />
            </label>
          )}

          {merged.smartExitMode === 'volume' && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Vol Lookback (sec)</span>
                <input
                  type="number"
                  name="smartVolLookbackSec"
                  min={5}
                  max={600}
                  value={merged.smartVolLookbackSec ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 30"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Volume Threshold (quote units)</span>
                <input
                  type="number"
                  name="smartVolThreshold"
                  min={0}
                  value={merged.smartVolThreshold ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 5000"
                  className={inp}
                />
              </label>
            </>
          )}

          {merged.smartExitMode === 'liquidity' && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Liq Lookback (sec)</span>
                <input
                  type="number"
                  name="smartLiqLookbackSec"
                  min={5}
                  max={600}
                  value={merged.smartLiqLookbackSec ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 60"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Liq Drop (%)</span>
                <input
                  type="number"
                  name="smartLiqDropPct"
                  min={0}
                  max={100}
                  step={0.1}
                  value={merged.smartLiqDropPct ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 25"
                  className={inp}
                />
              </label>
            </>
          )}

          {/* Legacy nested advanced */}
          {merged.smartExitMode === 'time' && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Max Hold (sec) — advanced</span>
                <input
                  type="number"
                  name="smartExit.time.maxHoldSec"
                  min="0"
                  value={merged.smartExit?.time?.maxHoldSec ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 600"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Min PnL % before Time Exit — advanced</span>
                <input
                  type="number"
                  name="smartExit.time.minPnLBeforeTimeExitPct"
                  min="0"
                  value={merged.smartExit?.time?.minPnLBeforeTimeExitPct ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 20"
                  className={inp}
                />
              </label>
            </>
          )}
          {merged.smartExitMode === 'volume' && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Window (sec) — advanced</span>
                <input
                  type="number"
                  name="smartExit.volume.volWindowSec"
                  min="1"
                  value={merged.smartExit?.volume?.volWindowSec ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 30"
                  className={inp}
                />
              </label>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Burst→Drop Exit if ≥ % — advanced</span>
                <input
                  type="number"
                  name="smartExit.volume.volDropPct"
                  min="0"
                  max="100"
                  value={merged.smartExit?.volume?.volDropPct ?? ""}
                  onChange={change}
                  disabled={disabled}
                  placeholder="e.g. 30"
                  className={inp}
                />
              </label>
            </>
          )}
          {merged.smartExitMode === 'liquidity' && (
            <label className="flex flex-col text-sm font-medium gap-1">
              <span>LP Outflow Exit if ≥ % — advanced</span>
              <input
                type="number"
                name="smartExit.liquidity.lpOutflowExitPct"
                min="0"
                max="100"
                value={merged.smartExit?.liquidity?.lpOutflowExitPct ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 50"
                className={inp}
              />
            </label>
          )}
        </div>
      </Card>

      <Card title="Post-Buy Watch">
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Duration (sec) <StrategyTooltip name="postBuyWatch.durationSec" />
            </span>
            <input
              type="number"
              name="postBuyWatch.durationSec"
              min="1"
              value={merged.postBuyWatch?.durationSec ?? 180}
              onChange={change}
              disabled={disabled}
              className={inp}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="postBuyWatch.lpPullExit"
              checked={merged.postBuyWatch?.lpPullExit !== false}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Exit on LP Pull <StrategyTooltip name="postBuyWatch.lpPullExit" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="postBuyWatch.authorityFlipExit"
              checked={merged.postBuyWatch?.authorityFlipExit !== false}
              onChange={change}
              disabled={disabled}
              className="accent-emerald-500"
            />
            Exit on Authority Flip <StrategyTooltip name="postBuyWatch.authorityFlipExit" />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1 sm:col-span-3">
            <span className="flex items-center gap-1">
              Rug Delay (blocks) <StrategyTooltip name="postBuyWatch.rugDelayBlocks" />
            </span>
            <input
              type="number"
              name="postBuyWatch.rugDelayBlocks"
              min="0"
              max="20"
              value={merged.postBuyWatch?.rugDelayBlocks ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 2"
              className={inp}
            />
          </label>
        </div>
      </Card>

      <Card title="Take-Profit & Trail">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              TP Ladder <StrategyTooltip name="tpLadder" />
            </span>
            <input
              type="text"
              name="tpLadder"
              value={merged.tpLadder}
              onChange={change}
              disabled={disabled}
              placeholder='e.g. "25,25,50"'
              className={inp}
            />
          </label>

          <label className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              Trailing Stop (%) <StrategyTooltip name="trailingStopPct" />
            </span>
            <input
              type="number"
              name="trailingStopPct"
              value={merged.trailingStopPct}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 10"
              className={inp}
            />
          </label>
        </div>
      </Card>
    </Section>
  );

const TokenListTab = () => (
  <Section>
    <Card title="Token List" className="sm:col-span-2">
      <TokenSourceSelector
        config={merged}   // use merged so defaults are present
        setConfig={setConfig}
        disabled={disabled}
      />
    </Card>
  </Section>
);

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="RPC & DEX Preferences">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                RPC Endpoints (comma) <StrategyTooltip name="rpcEndpoints" />
              </span>
              <input
                type="text"
                name="rpcEndpoints"
                value={merged.rpcEndpoints ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="https://rpc1, https://rpc2"
                className={inp}
              />
            </label>
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                RPC Max Errors <StrategyTooltip name="rpcMaxErrors" />
              </span>
              <input
                type="number"
                name="rpcMaxErrors"
                min="1"
                value={merged.rpcMaxErrors ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 3"
                className={inp}
              />
            </label>
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                Allowed DEXes <StrategyTooltip name="allowedDexes" />
              </span>
              <input
                type="text"
                name="allowedDexes"
                value={merged.allowedDexes ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. Raydium,Orca,Meteora"
                className={inp}
              />
            </label>
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                Excluded DEXes <StrategyTooltip name="excludedDexes" />
              </span>
              <input
                type="text"
                name="excludedDexes"
                value={merged.excludedDexes ?? ""}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. Step,Crema"
                className={inp}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="splitTrade"
                checked={!!merged.splitTrade}
                onChange={change}
                disabled={disabled}
                className="accent-emerald-500"
              />
              Split Trade (multi-pool) <StrategyTooltip name="splitTrade" />
            </label>
          </div>
        </Card>

        <Card title="Retry Policy">
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="flex flex-col text-sm font-medium gap-1">
              Max Attempts
              <input
                type="number"
                name="retryPolicy.max"
                value={merged.retryPolicy?.max ?? 3}
                onChange={change}
                disabled={disabled}
                className={inp}
              />
            </label>
            <label className="flex flex-col text-sm font-medium gap-1">
              Bump CU Step
              <input
                type="number"
                name="retryPolicy.bumpCuStep"
                value={merged.retryPolicy?.bumpCuStep ?? 2000}
                onChange={change}
                disabled={disabled}
                className={inp}
              />
            </label>
            <label className="flex flex-col text-sm font-medium gap-1">
              Bump Tip Step
              <input
                type="number"
                name="retryPolicy.bumpTipStep"
                value={merged.retryPolicy?.bumpTipStep ?? 1000}
                onChange={change}
                disabled={disabled}
                className={inp}
              />
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="retryPolicy.routeSwitch"
                checked={merged.retryPolicy?.routeSwitch !== false}
                onChange={change}
                disabled={disabled}
                className="accent-emerald-500"
              />
              Route Switch
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="retryPolicy.rpcFailover"
                checked={merged.retryPolicy?.rpcFailover !== false}
                onChange={change}
                disabled={disabled}
                className="accent-emerald-500"
              />
              RPC Failover
            </label>
          </div>
        </Card>

        <Card title="Private Relay & Idempotency">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Private Relay */}
            <div>
              <label className="flex items-center space-x-2 mb-2">
                <input
                  type="checkbox"
                  checked={merged.privateRelay?.enabled || false}
                  onChange={(e) => onChangeSection('privateRelay', 'enabled', e.target.checked)}
                  className="accent-emerald-500"
                />
                <span className="text-sm">Enable private relay</span>
              </label>
              {merged.privateRelay?.enabled && (
                <div className="space-y-2">
                  <label className="block">
                    <span className="block text-sm">Relay URLs (comma)</span>
                    <input
                      type="text"
                      className={inp}
                      value={(merged.privateRelay.urls || []).join(',')}
                      onChange={(e) =>
                        onChangeSection(
                          'privateRelay',
                          'urls',
                          e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter((v) => v)
                        )
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm">Mode</span>
                    <select
                      className={inp}
                      value={merged.privateRelay.mode || 'bundle'}
                      onChange={(e) => onChangeSection('privateRelay', 'mode', e.target.value)}
                    >
                      <option value="bundle">bundle</option>
                      <option value="tx">tx</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            {/* Idempotency */}
            <div>
              <div className="space-y-2">
                <label className="block">
                  <span className="block text-sm">TTL (seconds)</span>
                  <input
                    type="number"
                    className={inp}
                    value={merged.idempotency?.ttlSec || 90}
                    onChange={(e) => onChangeSection('idempotency', 'ttlSec', Number(e.target.value))}
                    min={1}
                  />
                </label>
                <label className="block">
                  <span className="block text-sm">Salt</span>
                  <input
                    type="text"
                    className={inp}
                    value={merged.idempotency?.salt || ''}
                    onChange={(e) => onChangeSection('idempotency', 'salt', e.target.value)}
                  />
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={merged.idempotency?.resumeFromLast !== false}
                    onChange={(e) => onChangeSection('idempotency', 'resumeFromLast', e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span className="text-sm">Resume pending on restart</span>
                </label>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Sizing & Probe">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Sizing */}
            <div className="space-y-2">
              <label className="block">
                <span className="block text-sm">Max Impact (%)</span>
                <input
                  type="number"
                  className={inp}
                  step="0.1"
                  value={merged.sizing?.maxImpactPct || 1.2}
                  onChange={(e) => onChangeSection('sizing','maxImpactPct', Number(e.target.value))}
                  min={0}
                />
              </label>
              <label className="block">
                <span className="block text-sm">Max Pool (%)</span>
                <input
                  type="number"
                  className={inp}
                  step="0.1"
                  value={merged.sizing?.maxPoolPct || 0.8}
                  onChange={(e) => onChangeSection('sizing','maxPoolPct', Number(e.target.value))}
                  min={0}
                  max={1}
                />
              </label>
              <label className="block">
                <span className="block text-sm">Minimum USD</span>
                <input
                  type="number"
                  className={inp}
                  value={merged.sizing?.minUsd || 50}
                  onChange={(e) => onChangeSection('sizing','minUsd', Number(e.target.value))}
                  min={0}
                />
              </label>
            </div>

            {/* Probe */}
            <div>
              <label className="flex items-center space-x-2 mb-2">
                <input
                  type="checkbox"
                  checked={merged.probe?.enabled || false}
                  onChange={(e) => onChangeSection('probe', 'enabled', e.target.checked)}
                  className="accent-emerald-500"
                />
                <span className="text-sm">Enable probe buy</span>
              </label>
              {merged.probe?.enabled && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="block text-sm">Probe Size (USD)</span>
                    <input
                      type="number"
                      className={inp}
                      value={merged.probe?.usd || 5}
                      onChange={(e) => onChangeSection('probe', 'usd', Number(e.target.value))}
                      min={0}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm">Scale Factor</span>
                    <input
                      type="number"
                      className={inp}
                      value={merged.probe?.scaleFactor || 4}
                      onChange={(e) => onChangeSection('probe','scaleFactor', Number(e.target.value))}
                      min={1}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm">Abort Impact (%)</span>
                    <input
                      type="number"
                      className={inp}
                      step="0.1"
                      value={merged.probe?.abortOnImpactPct || 2.0}
                      onChange={(e) => onChangeSection('probe','abortOnImpactPct', Number(e.target.value))}
                      min={0}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm">Delay (ms)</span>
                    <input
                      type="number"
                      className={inp}
                      value={merged.probe?.delayMs || 250}
                      onChange={(e) => onChangeSection('probe','delayMs', Number(e.target.value))}
                      min={0}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Listeners">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Pump.fun */}
            <div>
              <div className="font-medium text-sm mb-2">Pump.fun Listener</div>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="pumpfun.enabled"
                    checked={!!merged.pumpfun?.enabled}
                    onChange={change}
                    disabled={disabled}
                    className="accent-emerald-500"
                  />
                  Enabled
                </label>
                <label className="flex flex-col text-sm font-medium gap-1">
                  Threshold (0–1)
                  <input
                    type="number"
                    step="0.01"
                    name="pumpfun.thresholdPct"
                    value={merged.pumpfun?.thresholdPct ?? 0.55}
                    onChange={change}
                    disabled={disabled}
                    className={inp}
                  />
                </label>
                <label className="flex flex-col text-sm font-medium gap-1">
                  Min SOL Liquidity
                  <input
                    type="number"
                    name="pumpfun.minSolLiquidity"
                    value={merged.pumpfun?.minSolLiquidity ?? 10}
                    onChange={change}
                    disabled={disabled}
                    className={inp}
                  />
                </label>
                <label className="flex flex-col text-sm font-medium gap-1">
                  Cooldown (sec)
                  <input
                    type="number"
                    name="pumpfun.cooldownSec"
                    value={merged.pumpfun?.cooldownSec ?? 120}
                    onChange={change}
                    disabled={disabled}
                    className={inp}
                  />
                </label>
              </div>
            </div>

            {/* Airdrops */}
            <div>
              <div className="font-medium text-sm mb-2">Airdrop / Dust Sniffer</div>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="airdrops.enabled"
                    checked={!!merged.airdrops?.enabled}
                    onChange={change}
                    disabled={disabled}
                    className="accent-emerald-500"
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="airdrops.autoSell"
                    checked={merged.airdrops?.autoSell !== false}
                    onChange={change}
                    disabled={disabled}
                    className="accent-emerald-500"
                  />
                  Auto Sell
                </label>
                <label className="flex flex-col text-sm font-medium gap-1">
                  Min USD Value
                  <input
                    type="number"
                    name="airdrops.minUsdValue"
                    value={merged.airdrops?.minUsdValue ?? 5}
                    onChange={change}
                    disabled={disabled}
                    className={inp}
                  />
                </label>
                <label className="flex flex-col text-sm font-medium gap-1">
                  Max Sell Slippage (%)
                  <input
                    type="number"
                    step="0.1"
                    name="airdrops.maxSellSlippagePct"
                    value={merged.airdrops?.maxSellSlippagePct ?? 1.0}
                    onChange={change}
                    disabled={disabled}
                    className={inp}
                  />
                </label>
              </div>
              {merged.airdrops?.enabled && (
                <div className="mt-3">
                  <label className="flex flex-col text-sm font-medium gap-1">
                    Whitelist Mints (comma)
                    <input
                      type="text"
                      value={(merged.airdrops?.whitelistMints ?? []).join(",")}
                      onChange={(e) => {
                        const mints = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        setConfig((prev) => ({
                          ...prev,
                          airdrops: {
                            ...(prev.airdrops ?? defaults.airdrops),
                            whitelistMints: mints,
                          },
                        }));
                      }}
                      disabled={disabled}
                      placeholder="mint1,mint2"
                      className={inp}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </Card>
      </Section>
              // ADD inside AdvancedTab (where you removed the block)
<Card title="Advanced Fields" className="sm:col-span-2">
  <AdvancedFields config={merged} setConfig={setConfig} disabled={disabled}/>
</Card>

    </>
  );

  /* ==================================================================== */
  return (
    <div className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl">
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-800 sticky top-0 z-[5] bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Turbo Sniper Config</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs sm:text-sm text-zinc-300">
              <input
                type="checkbox"
                className="accent-emerald-500"
                checked={showRequiredOnly}
                onChange={(e) => setShowRequiredOnly(e.target.checked)}
              />
              Required only
            </label>
            <button
              onClick={() => onClose()}
              className="hidden sm:inline-flex px-2.5 py-1.5 text-xs rounded-md border border-zinc-700 hover:border-zinc-600 text-zinc-300"
            >
              Close
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-3 sm:gap-4 relative">
          <TabButton active={activeTab==="core"} onClick={()=>setActiveTab("core")} badge={tabErr.core}>Core</TabButton>
          <TabButton active={activeTab==="execution"} onClick={()=>setActiveTab("execution")} badge={tabErr.execution}>Execution</TabButton>
          <TabButton active={activeTab==="risk"} onClick={()=>setActiveTab("risk")} badge={tabErr.risk}>Risk &amp; Safety</TabButton>
          <TabButton active={activeTab==="exits"} onClick={()=>setActiveTab("exits")} badge={tabErr.exits}>Exits</TabButton>
          <TabButton active={activeTab==="tokenlist"} onClick={()=>setActiveTab("tokenlist")} badge={tabErr.tokenlist} > Token List</TabButton>         
          <TabButton active={activeTab==="advanced"} onClick={()=>setActiveTab("advanced")} badge={tabErr.advanced}>Advanced</TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        {/* Description ribbon (kept from original for context) */}
        <div className="bg-zinc-800/60 text-zinc-300 text-xs rounded-md p-2 mb-4">
          This strategy hunts early-stage listings, letting you tune price &amp; volume windows, token age, and more to precision-snipe brand-new or trending tokens.
        </div>

        {errors.length > 0 && (
          <div className="bg-red-900/40 text-red-200 text-xs p-2 rounded-md mb-4 border border-red-800/50 space-y-1">
            {errors.map((err, i) => (<div key={i}>{err}</div>))}
          </div>
        )}

        {activeTab === "core"      && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "risk"      && <RiskTab />}
        {activeTab === "exits"     && <ExitsTab />}
        {activeTab === "advanced"  && <AdvancedTab />}
        {activeTab === "tokenlist"  && <TokenListTab />}

        {/* Strategy Summary (kept; trimmed to fit the new flow) */}
        <div className="mt-6 bg-zinc-800/60 rounded-md p-3">
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Sniper Summary</span> — List:&nbsp;
            {merged.overrideMonitored
              ? <span className="text-yellow-300 font-semibold">📝 My Monitored</span>
              : <span className="text-emerald-300 font-semibold">
                  {feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom"}
                </span>
            };&nbsp;
            Pump <span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.priceWindow}</span>;
            &nbsp;Volume&nbsp;
            <span className="text-emerald-300 font-semibold">
              ≥ ${(+merged.volumeThreshold).toLocaleString()}
            </span>
            &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
            {(merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes) ? (
              <>; Age&nbsp;
                {merged.minTokenAgeMinutes && (<>≥ <span className="text-rose-300 font-semibold">{merged.minTokenAgeMinutes}m</span></>)}
                {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
                {merged.maxTokenAgeMinutes && (<>≤ <span className="text-rose-300 font-semibold">{merged.maxTokenAgeMinutes}m</span></>)}
              </>
            ) : null}
            {(merged.minMarketCap || merged.maxMarketCap) ? (
              <>; MC&nbsp;
                {merged.minMarketCap && (<>≥ <span className="text-orange-300 font-semibold">
                  ${(+merged.minMarketCap).toLocaleString()}
                </span></>)}
                {merged.minMarketCap && merged.maxMarketCap && " / "}
                {merged.maxMarketCap && (<>≤ <span className="text-orange-300 font-semibold">
                  ${(+merged.maxMarketCap).toLocaleString()}
                </span></>)}
              </>
            ) : null}
            {(merged.ghostMode || merged.multiBuy || merged.prewarmAccounts || merged.autoRug || merged.multiRoute) && (
              <>; Flags&nbsp;
                {merged.ghostMode && <span className="text-emerald-300 font-semibold"> Ghost</span>}
                {merged.multiBuy && <span className="text-indigo-300 font-semibold">
                  {" "}Multi{merged.multiBuyCount > 1 ? `×${merged.multiBuyCount}` : ""}
                </span>}
                {merged.prewarmAccounts && <span className="text-pink-300 font-semibold"> Prewarm</span>}
                {merged.autoRug && <span className="text-rose-300 font-semibold"> Rug</span>}
                {merged.multiRoute && <span className="text-yellow-300 font-semibold"> MultiRoute</span>}
              </>
            )}
            {merged.turboMode && <span>; Turbo <span className="text-emerald-300 font-semibold">On</span></span>}
            {merged.autoRiskManage && <span>; AutoRisk <span className="text-emerald-300 font-semibold">On</span></span>}
          </p>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t border-zinc-800 p-3 sm:p-4 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75 rounded-b-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">
            {errors.length > 0 ? (
              <span>⚠️ {errors.length} validation {errors.length === 1 ? "issue" : "issues"}</span>
            ) : (
              <span>Ready</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...defaults, ...(prev ?? {}) }))}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 hover:border-zinc-600 text-zinc-200"
              title="Reset visible values to defaults (non-destructive merge)"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={applySafePreset}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
              title="Apply conservative turbo-safe preset"
            >
              Safe Turbo
            </button>
            <button
              type="button"
              onClick={() => onSavePreset(merged)}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 hover:border-zinc-600 text-zinc-200"
            >
              Save Preset
            </button>
            <button
              type="button"
              onClick={() => onApply(merged)}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-md bg-emerald-500 hover:bg-emerald-600 text-black font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TurboSniperConfig;
