// frontend/src/components/Strategy_Configs/TurboSniperConfig.jsx
// TurboSniperConfig.jsx — Turbo + Full Sniper Additions + Strategy Summary (+ Safe Turbo preset)
import React, { useMemo } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";
import validateTurboSniperConfig from "./validators/turboSniperValidator";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
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
  // These fields expose advanced tuning knobs for
  // experimental sniping features added by the user.
  // See ARCHITECTURE.MD for details on each key.
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
  // post-buy watch options are nested under postBuyWatch to keep
  // related fields together.  RugDelayBlocks is nested accordingly.
  "postBuyWatch.rugDelayBlocks",
];

/* fields required by validator ----------------------------------------
 * Turbo Sniper shares the same required fields as the base Sniper: the
 * pump entry % and minimum volume.  Additional turbo toggles are optional.
 */
export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

const turboSniperConfig = ({ config = {}, setConfig, disabled, children }) => {
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

    // Smart exit configuration.  When smartExitMode is set to one of
    // "time", "volume" or "liquidity" the corresponding nested
    // configuration is used.  An empty string disables smart exits.
    smartExitMode       : "",
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

    // LP Gate configuration used to guard entries.  All fields are
    // optional; leave blank to disable.  The large/small probes are
    // expressed in whole SOL units.
    liqGate             : {
      minPoolUsd: "",
      maxImpactPctAtLarge: "",
      liqProbeSmallSol: "",
      liqProbeLargeSol: "",
    },

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

    /*
     * ---------------------------------------------------------------------
     * Experimental heuristics and risk controls
     *
     * The following fields allow advanced users to fine‑tune how the Turbo
     * Sniper filters tokens and manages positions.  They are optional and
     * disabled by default.  When enabled, these knobs will be passed down
     * to the backend strategy where they are consumed by additional
     * heuristics (see turboSniper.js for implementation details).  The
     * defaults here are intentionally conservative – adjust at your own
     * risk.
     */

    /**
     * Enable insider/deployer heuristics.  When true the strategy will
     * apply extra filtering based on the relationships between the token
     * deployer, early funders and related wallets.  Disabled by default.
     */
    enableInsiderHeuristics: false,

    /**
     * Maximum percentage of total supply allowed to be held by the top
     * wallets (top 5 holders).  Applies only when insider heuristics are
     * enabled.  A value of 65 means the top five wallets may collectively
     * own up to 65% of the supply.  Set to null to disable this check.
     */
    maxHolderPercent: 65,

    /**
     * Require the freeze authority on new mints to be revoked before
     * purchasing.  When true any mint with a non‑null freeze authority
     * will be skipped, even if other safety checks pass.  Disabled by
     * default.
     */
    requireFreezeRevoked: false,

    /**
     * Use the lowest‑latency pool detection stream available (LaserStream/
     * ShredStream or Geyser).  When false the strategy falls back to
     * standard WebSocket log subscriptions.  Implementation support for
     * LaserStream is stubbed out but the flag is exposed for future use.
     */
    enableLaserStream: false,

    /**
     * Number of wallets to use in parallel when filling.  When greater
     * than 1 the backend will enable the parallel filler and split the
     * notional amount across the specified number of wallets.  If 1 (the
     * default) a single wallet will be used.
     */
    multiWallet: 1,

    /**
     * Align transaction submission to the current leader’s auction tick.
     * When enabled the leaderTiming scheduler will be automatically
     * activated regardless of other settings.  Disabled by default.
     */
    alignToLeader: false,

    /**
     * Define a custom compute unit price curve.  Provide either a comma
     * separated list of micro‑lamport prices or a JSON object describing
     * the curve.  The backend interprets this string at runtime.  Leave
     * empty to use the default adaptive range (cuPriceMicroLamportsMin /
     * cuPriceMicroLamportsMax).
     */
    cuPriceCurve: "",

    /**
     * Define a custom tip curve.  Accepts the same formats as
     * cuPriceCurve.  This field is distinct from the existing
     * `tipCurve` dropdown, which toggles between predefined flat and
     * ramp curves.  Use this field to supply explicit coefficients.
     */
    tipCurveCoefficients: "",

    /**
     * Risk level thresholds expressed as a comma separated list (e.g.
     * "0.2,0.5,0.8").  The backend may interpret these values to
     * dynamically size positions based on detected risk.  Leave blank to
     * disable dynamic sizing.
     */
    riskLevels: "",

    /**
     * Static stop loss expressed as a percentage.  When set the
     * strategy will exit a position if price falls below this
     * percentage relative to the entry.  Note: trailing stops are
     * configured separately via `trailingStopPct`.
     */
    stopLossPercent: "",

    // NOTE: rugDelayBlocks has been moved under postBuyWatch.rugDelayBlocks.
    // The top-level property is retained for backward compatibility but
    // is not used by the updated turbo sniper strategy.  To avoid
    // confusion we set it to an empty string by default.
    rugDelayBlocks: "",

    // Cross‑feed token resolver config
    feeds: {
      order: ["ws", "birdeye", "onchain"],
      ttlMs: 800,
      timeoutMs: 400,
    },

    // Auto slippage governor
    slippageAuto: {
      enabled: true,
      floorPct: 0.5,
      ceilPct: 2.0,
      sensitivity: 0.6,
    },

    // Post‑trade chain defaults
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
    // support nested fields for objects like postBuyWatch.durationSec or iceberg.tranches
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
              // Keep these fields as strings; do not coerce numbers
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
              // New custom string fields
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
  const priceWins  = ["", "1m","5m","15m","30m","1h","2h","4h","6h"];
  const volumeWins = ["", "1m","5m","30m","1h","4h","8h","24h"];

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  // Run validations and surface errors inline
  const errors = validateTurboSniperConfig(merged);

  /* ==================================================================== */
  return (
    <>
      {/* ——— description + Safe preset ——— */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-2">
        This strategy hunts early-stage listings, letting you tune price &amp; volume
        windows, token age, and more to precision-snipe brand-new or trending tokens.
      </div>

      {/* ——— Smart Exit (Turbo Only) ——— */}
      <div className="border border-zinc-700 rounded-md p-3 mt-6">
        <div className="font-semibold text-sm mb-2">Smart Exit</div>
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
          {merged.smartExitMode === 'time' && (
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>Max Hold (sec)</span>
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
                <span>Min PnL % before Time Exit</span>
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
                <span>Window (sec)</span>
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
                <span>Burst→Drop Exit if ≥ %</span>
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
            <>
              <label className="flex flex-col text-sm font-medium gap-1">
                <span>LP Outflow Exit if ≥ %</span>
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
            </>
          )}
        </div>
      </div>

      {/* ——— Liquidity Gate ——— */}
      <div className="border border-zinc-700 rounded-md p-3 mt-6">
        <div className="font-semibold text-sm mb-2">LP Gate</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            <span>Min Pool USD</span>
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
            <span>Max Impact @ Large %</span>
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
            <span>Small Probe (SOL)</span>
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
            <span>Large Probe (SOL)</span>
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
        </div>
      </div>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={applySafePreset}
          disabled={disabled}
          className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Safe Turbo
        </button>
      </div>
      {errors.length > 0 && (
        <div className="bg-red-900/50 text-red-300 text-xs p-2 rounded-md mb-3 space-y-1">
          {errors.map((err, i) => (<div key={i}>{err}</div>))}
        </div>
      )}

      {/* ——— thresholds ——— */}
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
            >
              <option value="">None</option>
              {priceWins.slice(1).map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* ——— volume filters ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
              {volumeWins.slice(1).map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* ——— token age (min/max) ——— */}
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

      {/* ——— Turbo & Risk Options ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        {/* Bundle Strategy — now always visible */}
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

        {/* Turbo execution toggle */}
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
      </div>

      {/* Auto risk & Private RPC */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {/* Auto risk management toggle */}
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
        {/* Private RPC URL input */}
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
      </div>

      {/* ——— Leader Timing + Quote/Idem TTL ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
          <div className="grid sm:grid-cols-2 gap-4 w-full">
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
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
        {/* ——— Private Relay ——— */}
      <section>
        <h3 className="font-semibold">Private Relay</h3>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={merged.privateRelay?.enabled || false}
            onChange={(e) =>
              onChangeSection('privateRelay', 'enabled', e.target.checked)
            }
          />
          <span>Enable private relay</span>
        </label>
        {merged.privateRelay?.enabled && (
          <div className="ml-4 space-y-2">
            <label className="block">
              <span className="block text-sm">Relay URLs (comma separated)</span>
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
                onChange={(e) =>
                  onChangeSection('privateRelay', 'mode', e.target.value)
                }
              >
                <option value="bundle">bundle</option>
                <option value="tx">tx</option>
              </select>
            </label>
          </div>
        )}
      </section>

      {/* ——— Idempotency ——— */}
      <section>
        <h3 className="font-semibold">Idempotency</h3>
        <div className="ml-4 space-y-2">
          <label className="block">
            <span className="block text-sm">TTL (seconds)</span>
            <input
              type="number"
              className={inp}
              value={merged.idempotency?.ttlSec || 90}
              onChange={(e) =>
                onChangeSection('idempotency', 'ttlSec', Number(e.target.value))
              }
              min={1}
            />
          </label>
          <label className="block">
            <span className="block text-sm">Salt</span>
            <input
              type="text"
              className={inp}
              value={merged.idempotency?.salt || ''}
              onChange={(e) =>
                onChangeSection('idempotency', 'salt', e.target.value)
              }
            />
          </label>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={merged.idempotency?.resumeFromLast !== false}
              onChange={(e) =>
                onChangeSection(
                  'idempotency',
                  'resumeFromLast',
                  e.target.checked
                )
              }
            />
            <span>Resume pending on restart</span>
          </label>
        </div>
      </section>

      {/* ——— Liquidity Sizing ——— */}
      <section>
        <h3 className="font-semibold">Liquidity Sizing</h3>
        <div className="ml-4 space-y-2">
          <label className="block">
            <span className="block text-sm">Max Impact (%)</span>
            <input
              type="number"
              className={inp}
              step="0.1"
              value={merged.sizing?.maxImpactPct || 1.2}
              onChange={(e) =>
                onChangeSection(
                  'sizing',
                  'maxImpactPct',
                  Number(e.target.value)
                )
              }
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
              onChange={(e) =>
                onChangeSection(
                  'sizing',
                  'maxPoolPct',
                  Number(e.target.value)
                )
              }
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
              onChange={(e) =>
                onChangeSection(
                  'sizing',
                  'minUsd',
                  Number(e.target.value)
                )
              }
              min={0}
            />
          </label>
        </div>
      </section>

      {/* ——— Probe Buy ——— */}
      <section>
        <h3 className="font-semibold">Probe Buy</h3>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={merged.probe?.enabled || false}
            onChange={(e) =>
              onChangeSection('probe', 'enabled', e.target.checked)
            }
          />
          <span>Enable probe buy</span>
        </label>
        {merged.probe?.enabled && (
          <div className="ml-4 space-y-2">
            <label className="block">
              <span className="block text-sm">Probe Size (USD)</span>
              <input
                type="number"
                className={inp}
                value={merged.probe?.usd || 5}
                onChange={(e) =>
                  onChangeSection('probe', 'usd', Number(e.target.value))
                }
                min={0}
              />
            </label>
            <label className="block">
              <span className="block text-sm">Scale Factor</span>
              <input
                type="number"
                className={inp}
                value={merged.probe?.scaleFactor || 4}
                onChange={(e) =>
                  onChangeSection(
                    'probe',
                    'scaleFactor',
                    Number(e.target.value)
                  )
                }
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
                onChange={(e) =>
                  onChangeSection(
                    'probe',
                    'abortOnImpactPct',
                    Number(e.target.value)
                  )
                }
                min={0}
              />
            </label>
            <label className="block">
              <span className="block text-sm">Delay (ms)</span>
              <input
                type="number"
                className={inp}
                value={merged.probe?.delayMs || 250}
                onChange={(e) =>
                  onChangeSection(
                    'probe',
                    'delayMs',
                    Number(e.target.value)
                  )
                }
                min={0}
              />
            </label>
          </div>
        )}
      </section>


      {/* ——— Advanced Sniper Flags ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        {/* Ghost mode */}
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
      </div>

      {/* Multi-buy */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
      </div>

      {/* Pre-warm / Rug / Multi-route */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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

      {/* ——— Jito bundle & fee tuning ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
        {/* removed: bundleStrategy select from inside Jito block; it is now always visible above */}
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
                CU Price Min (µLAM)
                <StrategyTooltip name="cuPriceMicroLamportsMin" />
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
                CU Price Max (µLAM)
                <StrategyTooltip name="cuPriceMicroLamportsMax" />
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
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
      </div>

      {/* ——— RPC & Kill Switch ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
      </div>

      {/* ——— Pool detection ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
      </div>

      {/* ——— DEX prefs & split ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
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

      {/* ——— Parallel Wallets (new) ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
          <div className="flex flex-col gap-2 w-full">
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

      {/* ——— Direct AMM Fallback ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
          <div className="flex flex-col gap-2">
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                First AMM Fraction (0–1)
                <StrategyTooltip name="directAmmFirstPct" />
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
          </div>
        )}
      </div>

      {/* ——— Experimental Detection & Risk ——— */}
      {/*
        These fields expose newly added heuristics and risk controls.  They are
        grouped together to avoid overwhelming the user.  Only enable
        features you understand – improper use may cause the bot to skip
        profitable trades or sell early.  See the strategy docs for
        guidance on tuning these parameters.
      */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        {/* Insider heuristics toggle */}
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
        {/* Max holder percent */}
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
        {/* Freeze authority requirement */}
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
        {/* Laser stream toggle */}
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
        {/* Multi‑wallet */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Multi‑Wallet <StrategyTooltip name="multiWallet" />
          </span>
          <input
            type="number"
            name="multiWallet"
            min="1"
            max="10"
            value={merged.multiWallet ?? 1}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 2"
            className={inp}
          />
        </label>
        {/* Align to leader */}
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
        {/* Stop loss percent */}
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
        {/* Rug delay blocks (nested under postBuyWatch) */}
        <label className="flex flex-col text-sm font-medium gap-1">
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
        {/* Custom compute unit price curve */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            CU Price Curve <StrategyTooltip name="cuPriceCurve" />
          </span>
          <input
            type="text"
            name="cuPriceCurve"
            value={merged.cuPriceCurve || ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 100,1000"
            className={inp}
          />
        </label>
        {/* Custom tip curve coefficients */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Tip Curve Coef <StrategyTooltip name="tipCurveCoefficients" />
          </span>
          <input
            type="text"
            name="tipCurveCoefficients"
            value={merged.tipCurveCoefficients || ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 0.1,0.5,0.9"
            className={inp}
          />
        </label>
        {/* Risk levels */}
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Risk Levels <StrategyTooltip name="riskLevels" />
          </span>
          <input
            type="text"
            name="riskLevels"
            value={merged.riskLevels || ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 0.2,0.5,0.8"
            className={inp}
          />
        </label>
      </div>

      {/* ——— Retry Policy (new) ——— */}
      <div className="border border-zinc-700 rounded-md p-3 mt-6">
        <div className="font-semibold text-sm mb-2">Retry Policy</div>
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
      </div>

      {/* ——— Post-Buy Watch ——— */}
      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Post-Buy Duration (sec)
            <StrategyTooltip name="postBuyWatch.durationSec" />
          </span>
        </label>
        <input
          type="number"
          name="postBuyWatch.durationSec"
          min="1"
          value={merged.postBuyWatch?.durationSec ?? 180}
          onChange={change}
          disabled={disabled}
          className={inp}
        />
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
      </div>

      {/* ——— Iceberg Entries & Impact Guard ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
          <div className="flex flex-col gap-2">
            <label className="flex flex-col text-sm font-medium gap-1">
              <span className="flex items-center gap-1">
                Tranches
                <StrategyTooltip name="iceberg.tranches" />
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
                Tranche Delay (ms)
                <StrategyTooltip name="iceberg.trancheDelayMs" />
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
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Impact Abort (%)
            <StrategyTooltip name="impactAbortPct" />
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
            Max Dynamic Slippage (%)
            <StrategyTooltip name="dynamicSlippageMaxPct" />
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

      {/* ——— Pump.fun Listener (new) ——— */}
      <div className="border border-zinc-700 rounded-md p-3 mt-6">
        <div className="font-semibold text-sm mb-2">Pump.fun Listener</div>
        <div className="grid sm:grid-cols-4 gap-4">
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

      {/* ——— Airdrop Sniffer (new) ——— */}
      <div className="border border-zinc-700 rounded-md p-3 mt-6">
        <div className="font-semibold text-sm mb-2">Airdrop / Dust Sniffer</div>
        <div className="grid sm:grid-cols-4 gap-4">
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

      {/* ——— Token feed selector, Advanced, children ——— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields      config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* ——— STRATEGY SUMMARY ——— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
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
          { (merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes) ? (
            <>; Age&nbsp;
              {merged.minTokenAgeMinutes && (
                <>≥ <span className="text-rose-300 font-semibold">{merged.minTokenAgeMinutes}m</span></>
              )}
              {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
              {merged.maxTokenAgeMinutes && (
                <>≤ <span className="text-rose-300 font-semibold">{merged.maxTokenAgeMinutes}m</span></>
              )}
            </>
          ) : null}
          { (merged.minMarketCap || merged.maxMarketCap) ? (
            <>; MC&nbsp;
              {merged.minMarketCap && (
                <>≥ <span className="text-orange-300 font-semibold">
                  ${(+merged.minMarketCap).toLocaleString()}
                </span></>
              )}
              {merged.minMarketCap && merged.maxMarketCap && " / "}
              {merged.maxMarketCap && (
                <>≤ <span className="text-orange-300 font-semibold">
                  ${(+merged.maxMarketCap).toLocaleString()}
                </span></>
              )}
            </>
          ) : null}

          { (merged.ghostMode || merged.multiBuy || merged.prewarmAccounts ||
             merged.autoRug   || merged.multiRoute) && (
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
    </>
  );
};

export default turboSniperConfig;
