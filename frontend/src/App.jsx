import React, { useEffect, useState, lazy, Suspense } from "react"
import { useNavigate, useLocation } from "react-router-dom";
import ConfigPanel from "@/components/Controls/ConfigPanel";
import WalletBalancePanel from "@/components/Dashboard/WalletBalancePanel"
import TargetToken from "@/components/Controls/TargetToken";
import { isFinite as _isFinite } from "lodash";
import { toast } from "sonner";
import "./styles/dashboard.css";
const LazyStrategyConsoleSheet = lazy(() => import("./components/Strategy_Configs/strategyConsoleSheet"));
const LazyBotStatusModal       = lazy(() => import("./components/Controls/Modals/BotStatusModal"));
import useSingleLogsSocket from "@/hooks/useSingleLogsSocket";
import { getWalletNetworth, getUserProfile, getPrefs, fetchWalletBalances } from "./utils/api"
import { openTradesCsv, getRecentTrades } from "./utils/trades_positions"
import Cookies from "js-cookie";
import { useUser } from "@/contexts/UserProvider";
import { useUserPrefs }    from "@/contexts/UserPrefsContext";
import { CircleDot,RefreshCw, } from "lucide-react";
import { startStrategy, stopStrategy, fetchBotStatus, fetchDetailedStatus, pauseStrategy, resumeStrategy, deleteStrategy, } from "@/utils/autobotApi";
import FloatingBotBeacon from "./components/Dashboard/BotBeaconModal";

const sanitizeConfig = (cfg = {}) =>
  Object.fromEntries(
    Object.entries(cfg)
      .filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .map(([k, v]) => [
        k,
        [
          "amountToSpend","snipeAmount","slippage","interval","maxTrades",
          "takeProfit","stopLoss","entryThreshold","volumeThreshold",
          "minTokenAgeMinutes","maxTokenAgeMinutes","minMarketCap","maxMarketCap",
          "maxSlippage","haltOnFailures","cooldown","delayBeforeBuyMs",
          "priorityFeeLamports","briberyAmount","tpPercent","slPercent",
          "intervalSec","lpOutflowExitPct","rugDelayBlocks", "minPoolUsd",
          "timeMaxHoldSec","timeMinPnLBeforeTimeExitPct",
        ].includes(k) && v !== "" ? Number(v) : v,
      ])
  );



const safeNum = (v, fallback = 0) => {
const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

 const SOL_MINT  = "So11111111111111111111111111111111111111112";
 const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

 function toNum(x) {
  const n = +x;
  return isNaN(n) ? undefined : n; }
function isNumeric(value) {
  return !isNaN(parseFloat(value)) && isFinite(value);
}
/* cascade helper: ui‑value → prefs → hard‑default */
const pick = (val, pref, hard) =>
  val != null && val !== "" ? +val : pref != null ? +pref : hard;
// Build shared base config
const buildBaseConfig = (cfg, selectedWallets, targetToken, activeWallet) => {
  const p = cfg._prefs || {};
  // Extract user/preference slippage values first so we can clamp them below
  const rawSlippage    = pick(cfg.slippage,  p.slippage,          0.5);
  const rawMaxSlippage = pick(cfg.maxSlippage, p.defaultMaxSlippage, 0.25);
  // Clamp slippage values into a sane range accepted by the backend. The API rejects configs with slippage or maxSlippage above ~10%; likewise
  // negative values are nonsensical.  Keeping these in [0,10] prevents invalid configuration errors during bot launch (e.g. "invalid config").
  const clampedSlippage    = Math.min(Math.max(rawSlippage,    0), 10);
  const clampedMaxSlippage = Math.min(Math.max(rawMaxSlippage, 0), 10);
  return {
    inputMint: cfg.buyWithUSDC ? USDC_MINT : SOL_MINT,
    monitoredTokens : cfg.useTargetToken && targetToken ? [targetToken] : [],
    walletId        : activeWallet?.id ?? null,
    amountToSpend   : safeNum(cfg.amountToSpend ?? cfg.amount),
    snipeAmount     : safeNum(cfg.snipeAmount   ?? cfg.amountToSpend ?? cfg.amount),
    slippage        : clampedSlippage,
    interval        : safeNum(cfg.interval, 3),
    maxTrades       : safeNum(cfg.maxTrades, 5),
    tokenFeed         : cfg.tokenFeed || "new",   // 🚀 always default to "new"
    haltOnFailures      : safeNum(cfg.haltOnFailures, 4),
    autoSell            : cfg.autoSell,   // optional object
    maxSlippage     : clampedMaxSlippage,
    cooldown        : toNum(cfg.cooldown), 
    maxOpenTrades: safeNum(cfg.maxOpenTrades),
    minPoolUsd: isUnset(cfg.minPoolUsd) ? 50_000 : Number(cfg.minPoolUsd),

    safetyEnabled     : cfg.safetyEnabled !== false,  // default ON
    safetyChecks      : (cfg.safetyChecks && typeof cfg.safetyChecks === "object" && Object.keys(cfg.safetyChecks).length)
                         ? cfg.safetyChecks
                         : { simulation: true, liquidity: true, authority: true, topHolders: true },
    maxDailyVolume: safeNum(cfg.maxDailyVolume),
    ...(pick(cfg.priorityFeeLamports, p.defaultPriorityFee, null) != null && {
      priorityFeeLamports: pick(cfg.priorityFeeLamports, p.defaultPriorityFee, 0),
    }),
    /* allow per-bot MEV settings to trump userPrefs */
    ...(cfg.mevMode != null
        ? { mevMode: cfg.mevMode }          // UI override
        : p.mevMode
        ? { mevMode: p.mevMode }            // user default
        : {}),  
    ...(pick(cfg.briberyAmount, p.briberyAmount, null) != null && {
      briberyAmount: pick(cfg.briberyAmount, p.briberyAmount, 0),
    }),
    // dryRun          : true,
    ...(cfg.takeProfit != null && {
      takeProfit: safeNum(cfg.takeProfit),
      tpPercent: safeNum(cfg.tpPercent, 100)
    }),
    ...(cfg.stopLoss != null && {
      stopLoss: safeNum(cfg.stopLoss),
      slPercent: safeNum(cfg.slPercent, 100)
    }),
  };
}


const CONFIG_BUILDERS = {
 sniper: (cfg, wallets, target, resolved, activeWallet) => {
    const base = buildBaseConfig(cfg, wallets, target, resolved, activeWallet);

    // Inline smart-exit mapping from flat UI fields
    const smartExitMode =
      typeof cfg.smartExitMode === "string" ? cfg.smartExitMode : "off";

    const smartExit =
      cfg.timeMaxHoldSec || cfg.timeMinPnLBeforeTimeExitPct
        ? {
            time: {
              maxHoldSec: Number(cfg.timeMaxHoldSec || 0),
              minPnLBeforeTimeExitPct: Number(cfg.timeMinPnLBeforeTimeExitPct || 0),
            },
          }
        : undefined;

    const postBuyWatch =
      cfg.intervalSec || cfg.authorityFlipExit || cfg.lpOutflowExitPct || cfg.rugDelayBlocks
        ? {
            intervalSec: Number(cfg.intervalSec ?? 5),
            authorityFlipExit: !!cfg.authorityFlipExit,
            lpOutflowExitPct: Number(cfg.lpOutflowExitPct ?? 50),
            rugDelayBlocks: Number(cfg.rugDelayBlocks ?? 0),
          }
        : undefined;

    return {
      ...base,
      entryThreshold    : safeNum(cfg.entryThreshold, 3),
      volumeThreshold   : safeNum(cfg.volumeThreshold, 50_000),
      priceWindow       : cfg.priceWindow,
      volumeWindow      : cfg.volumeWindow,
      tokenFeed         : cfg.tokenFeed || (cfg.monitoredTokens?.length ? undefined : "new"),
      minTokenAgeMinutes: cfg.minTokenAgeMinutes,
      maxTokenAgeMinutes: cfg.maxTokenAgeMinutes,
      delayBeforeBuyMs  : toNum(cfg.delayBeforeBuyMs),
      minMarketCap      : cfg.minMarketCap,
      maxMarketCap      : cfg.maxMarketCap,

      // NEW: Sniper-only smart-exit wiring
      ...(smartExitMode && smartExitMode !== "off" ? { smartExitMode } : {}),
      ...(smartExit ? { smartExit } : {}),
      ...(postBuyWatch ? { postBuyWatch } : {}),
    };
  },
  scalper: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    entryThreshold: safeNum(cfg.entryThreshold, 3),
    priceWindow: cfg.priceWindow,
    volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
    volumeWindow: cfg.volumeWindow,
    volumeSpikeMultiplier: safeNum(cfg.volumeSpikeMultiplier),
    useSignals: !!cfg.useSignals,
    maxHoldSeconds: safeNum(cfg.maxHoldSeconds),
    disableSafety: !!cfg.disableSafety,
    safetyChecks: cfg.safetyChecks,
    minMarketCap: cfg.minMarketCap,
    maxMarketCap: cfg.maxMarketCap,
  }),

  dipBuyer: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    dipThreshold: safeNum(cfg.dipThreshold),
    recoveryWindow: cfg.recoveryWindow,
    volumeWindow: cfg.volumeWindow,
    volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
  }),

  breakout: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    breakoutThreshold: safeNum(cfg.breakoutThreshold, 1),
    volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
    volumeWindow: cfg.volumeWindow,
    priceWindow: cfg.priceWindow,
  }),
  trendFollower: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    entryThreshold: safeNum(cfg.priceChangeThreshold, 3),
    volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
    trendWindow: cfg.trendWindow,
    priceWindow: cfg.priceWindow,
    volumeWindow: cfg.volumeWindow,
    // new trend follower settings
    emaPeriods: cfg.emaPeriods,
    trailingPct: safeNum(cfg.trailingPct),
    sarEnabled: !!cfg.sarEnabled,
    pyramidEnabled: !!cfg.pyramidEnabled,
    riskPerAdd: safeNum(cfg.riskPerAdd),
    maxRisk: safeNum(cfg.maxRisk),
    delayBeforeBuyMs: safeNum(cfg.delayBeforeBuyMs),
    maxOpenTrades: safeNum(cfg.maxOpenTrades),
    maxDailyVolume: safeNum(cfg.maxDailyVolume),
    minMarketCap: cfg.minMarketCap,
    maxMarketCap: cfg.maxMarketCap,
    useSignals: !!cfg.useSignals,
    maxHoldSeconds: safeNum(cfg.maxHoldSeconds),
  }),
  delayedSniper: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    delayBeforeBuyMs: safeNum(cfg.delayBeforeBuyMs),
    entryThreshold: safeNum(cfg.entryThreshold, 3),
    volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
    priceWindow: cfg.priceWindow,
    volumeWindow: cfg.volumeWindow,
    minTokenAgeMinutes: cfg.minTokenAgeMinutes,
    maxTokenAgeMinutes: cfg.maxTokenAgeMinutes,
    // new delayed sniper settings
    breakoutPct: safeNum(cfg.breakoutPct),
    pullbackPct: safeNum(cfg.pullbackPct),
    ignoreBlocks: safeNum(cfg.ignoreBlocks),
    maxOpenTrades: safeNum(cfg.maxOpenTrades),
    maxDailyVolume: safeNum(cfg.maxDailyVolume),
    minMarketCap: cfg.minMarketCap,
    maxMarketCap: cfg.maxMarketCap,
  }),
  chadMode: (cfg, wallets, target, resolved, activeWallet) => ({
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),
    // multi‑target toggle preserved in real code
    ...(cfg.useMultiTargets
      ? { outputMints: cfg.targetTokens?.split(/\s+/).filter(Boolean) }
      : { outputMint: cfg.outputMint }),
    minVolumeRequired: safeNum(cfg.minVolumeRequired),
    priorityFeeLamports: pick(cfg.priorityFeeLamports, (cfg._prefs || {}).defaultPriorityFee, 10_000),
    slippageMaxPct: safeNum(cfg.slippageMaxPct, 10),
    feeEscalationLamports: safeNum(cfg.feeEscalationLamports, 5_000),
    panicDumpPct: safeNum(cfg.panicDumpPct, 15),
    autoSell: cfg.autoSell,
    useSignals: !!cfg.useSignals,
  }),
rebalancer: function (cfg, _target, resolvedWallets, activeWallet) {
  const p = cfg._prefs || {};
  let raw = toNum(cfg.rebalanceThreshold);
  let thresh = !isNumeric(raw) ? 2 : raw === 0 ? 0.0001 : raw;

  return {
    walletLabels        : resolvedWallets,
    walletId            : activeWallet?.id ?? null,
    maxRebalances       : safeNum(cfg.maxRebalances, 4),
    slippage          : pick(cfg.slippage,            p.slippage,             0.5),
   targetAllocations   : cfg.targetAllocations ?? cfg.targetWeights,
    rebalanceThreshold  : thresh,
    rebalanceInterval   : safeNum(cfg.rebalanceInterval, 600000),
    maxSlippage       : pick(cfg.maxSlippage,         p.defaultMaxSlippage,   0.25),
    priorityFeeLamports: pick(cfg.priorityFeeLamports, p.defaultPriorityFee, 20_000),
    autoWallet          : !!cfg.autoWallet,
    haltOnFailures      : safeNum(cfg.haltOnFailures, 4), 
    // dryRun              : true,
  };
},
rotationBot: (cfg, selectedWallets, _target, resolvedWallets, activeWallet) => {
  const p = cfg._prefs || {};
    // Prefer the wallets chosen **inside** the Stealth-Bot modal.
  const labels = Array.isArray(cfg.wallets) && cfg.wallets.length ? cfg.wallets : selectedWallets; 
 // make sure we have numeric DB ids (skip pub‑key strings)
 const ids = selectedWallets
   .filter(w => typeof w === "object" && Number.isInteger(w.id))
   .map(w => w.id);  
   
  return {
  /* UI‑friendly list of labels (just strings) */
  walletLabels : labels,
  wallets: labels,
  /* Numeric wallet IDs that backend needs */
  ...(ids.length ? { walletIds: ids } : {}),     // optional  tokens            : Array.isArray(cfg.tokens) && cfg.tokens.length ? cfg.tokens : undefined,
  sectors           : cfg.sectors ?? undefined,
  tokens            : Array.isArray(cfg.tokens) && cfg.tokens.length ? cfg.tokens : undefined,
  rotationInterval  : safeNum(cfg.rotationInterval),   // 30 min default
  priceChangeWindow : cfg.priceChangeWindow ?? "",
  minMomentum       : safeNum(cfg.minMomentum), 
  positionSize      : safeNum( cfg.positionSize ?? cfg.amountToSpend ?? cfg.amount, 0.02),
  cooldown          : safeNum(cfg.cooldown, 60_000),
  // maxDailyVolume    : safeNum(cfg.maxDailyVolume, 5),
  maxRotations      : safeNum(cfg.maxRotations, 5),
  maxTrades         : safeNum(cfg.maxTrades ?? cfg.maxRotations ?? 5),
  slippage    : pick(cfg.slippage,            p.slippage,             0.5),
  maxSlippage : pick(cfg.maxSlippage,         p.defaultMaxSlippage,   0.25),
  priorityFeeLamports: pick(cfg.priorityFeeLamports, p.defaultPriorityFee, 0),
  haltOnFailures    : safeNum(cfg.haltOnFailures, 4),
  // dryRun            : true,
   };
},

  paperTrader: (cfg, wallets, target, resolved, activeWallet) => {
    const base = buildBaseConfig(cfg, wallets, target, resolved, activeWallet);
    // Build the core config identical to Sniper but force dryRun
    const core = {
      ...base,
      dryRun: true,
      outputMint: cfg.outputMint,
      maxSpendPerToken: safeNum(cfg.maxSpendPerToken ?? cfg.positionSize),
      entryThreshold: safeNum(cfg.entryThreshold, 3),
      volumeThreshold: safeNum(cfg.volumeThreshold, 50000),
      priceWindow: cfg.priceWindow,
      volumeWindow: cfg.volumeWindow,
      tokenFeed: cfg.tokenFeed || (cfg.monitoredTokens?.length ? undefined : "new"),
      minTokenAgeMinutes: cfg.minTokenAgeMinutes,
      maxTokenAgeMinutes: cfg.maxTokenAgeMinutes,
    };
    return {
      ...core,
      ...(cfg.execModel ? { execModel: cfg.execModel } : {}),
      ...(cfg.seed ? { seed: cfg.seed } : {}),
      ...(cfg.slippageBpsCap != null && cfg.slippageBpsCap !== "" ? { slippageBpsCap: cfg.slippageBpsCap } : {}),
      ...(cfg.latency && Object.keys(cfg.latency).length ? { latency: cfg.latency } : {}),
      ...(cfg.failureRates && Object.keys(cfg.failureRates).length ? { failureRates: cfg.failureRates } : {}),
      ...(cfg.partials && Object.keys(cfg.partials).length ? { partials: cfg.partials } : {}),
      ...(cfg.enableShadowMode != null ? { enableShadowMode: cfg.enableShadowMode } : {}),
    };
  },
stealthBot: (cfg, selectedWallets, activeWallet)  => {
  const p = cfg._prefs || {};
  // Prefer the wallets chosen **inside** the Stealth-Bot modal.
  const labels =
    Array.isArray(cfg.wallets) && cfg.wallets.length
      ? cfg.wallets                // set by StealthBotConfig
      : selectedWallets;           // fall-back to global picker
  return {
      wallets: labels,
     tokenMint   : cfg.tokenMint,
     positionSize: +cfg.positionSize || 0.02,
     slippage            : pick(cfg.slippage,            p.slippage,             0.5),
     maxSlippage         : pick(cfg.maxSlippage,         p.defaultMaxSlippage,   0.25),
     priorityFeeLamports : pick(cfg.priorityFeeLamports, p.defaultPriorityFee,    0),
     dryRun      : !!cfg.dryRun,
   };
},
scheduleLauncher: (cfg, wallets, target, resolved, activeWallet) => {
  const p = cfg._prefs || {};

  return {
    ...buildBaseConfig(cfg, wallets, target, resolved, activeWallet),

    outputMint          : cfg.outputMint,
    startTime           : cfg.startTime,                            // ISO timestamp
    interval            : safeNum(cfg.interval, 30),                // seconds between attempts
    maxTrades           : safeNum(cfg.maxTrades, 1),
    haltOnFailures      : safeNum(cfg.haltOnFailures, 3),
    limitPrices         : Array.isArray(cfg.limitPrices)
                            ? cfg.limitPrices
                                .map(v => +v)
                                .filter(n => Number.isFinite(n))
                            : undefined,
     mevMode             : cfg.mevMode || p.mevMode || "fast",
     ...(pick(cfg.briberyAmount, p.briberyAmount, null) != null && {
       briberyAmount: pick(cfg.briberyAmount, p.briberyAmount, 0),
     }),
    priorityFeeLamports : pick(cfg.priorityFeeLamports, p.defaultPriorityFee, 0),

    ...(cfg.takeProfit != null && {
      takeProfit : safeNum(cfg.takeProfit),
      tpPercent  : safeNum(cfg.tpPercent, 100),
    }),
    ...(cfg.stopLoss != null && {
      stopLoss   : safeNum(cfg.stopLoss),
      slPercent  : safeNum(cfg.slPercent, 100),
    }),
    // ⛔ disabled sniper filters
    tokenFeed           : undefined,
    monitoredTokens     : [],
    entryThreshold      : undefined,
    volumeThreshold     : undefined,
    minTokenAgeMinutes  : undefined,
    maxTokenAgeMinutes  : undefined,
    priceWindow         : undefined,
    volumeWindow        : undefined,
    autoSell            : undefined,
  };
},

  /* ───────────────────────── Turbo Sniper ──────────────────────────── */
  /**
   * Build config for the Turbo Sniper strategy.  Extends the base Sniper
   * config with a number of performance and safety toggles.  Many of
   * these fields are optional – only truthy values will be passed to
   * the backend.  Numeric fields are converted using safeNum to avoid
   * NaN propagation.
   */
  turboSniper: (cfg, wallets, target, resolved, activeWallet) => {
    const base = buildBaseConfig(cfg, wallets, target, resolved, activeWallet);
    return {
      ...base,
      entryThreshold: safeNum(cfg.entryThreshold, 3),
      volumeThreshold: safeNum(cfg.volumeThreshold, 50_000),
      priceWindow: cfg.priceWindow,
      volumeWindow: cfg.volumeWindow,
      tokenFeed: cfg.tokenFeed || (cfg.monitoredTokens?.length ? undefined : "new"),
      minTokenAgeMinutes: cfg.minTokenAgeMinutes,
      maxTokenAgeMinutes: cfg.maxTokenAgeMinutes,
      minMarketCap: cfg.minMarketCap,
      maxMarketCap: cfg.maxMarketCap,
      ghostMode: !!cfg.ghostMode,
      coverWalletId: cfg.coverWalletId,
      multiBuy: !!cfg.multiBuy,
      multiBuyCount: safeNum(cfg.multiBuyCount, 2),
      prewarmAccounts: !!cfg.prewarmAccounts,
      multiRoute: !!cfg.multiRoute,
      autoRug: !!cfg.autoRug,
      useJitoBundle: !!cfg.useJitoBundle,
      jitoTipLamports: safeNum(cfg.jitoTipLamports),
      jitoRelayUrl: cfg.jitoRelayUrl,
      autoPriorityFee: !!cfg.autoPriorityFee,
      rpcEndpoints: cfg.rpcEndpoints,
      rpcMaxErrors: safeNum(cfg.rpcMaxErrors),
      killSwitch: !!cfg.killSwitch,
      killThreshold: safeNum(cfg.killThreshold),
      poolDetection: !!cfg.poolDetection,
      allowedDexes: cfg.allowedDexes,
      excludedDexes: cfg.excludedDexes,
      splitTrade: !!cfg.splitTrade,
      tpLadder: cfg.tpLadder,
      trailingStopPct: safeNum(cfg.trailingStopPct),
      turboMode: !!cfg.turboMode,
      autoRiskManage: !!cfg.autoRiskManage,
      privateRpcUrl: cfg.privateRpcUrl,
      // new turbo sniper settings
      maxOpenTrades: safeNum(cfg.maxOpenTrades),
      delayBeforeBuyMs: safeNum(cfg.delayBeforeBuyMs),
      priorityFeeLamports: pick(cfg.priorityFeeLamports, (cfg._prefs || {}).defaultPriorityFee, 0),
      // Smart exit wiring: pass through mode and nested configuration
      // only when defined.  Undefined values are pruned by sanitizeConfig.
      smartExitMode: cfg.smartExitMode || undefined,
      smartExit: cfg.smartExit || undefined,
      // Liquidity gate wiring
      liqGate: cfg.liqGate || undefined,
      // Post buy watcher is nested under its own key.  Include if
      // present to retain custom duration / exits / rug delay.
      postBuyWatch: cfg.postBuyWatch || undefined,
      // UI stamping flag.  This is forwarded to the backend but
      // consumed primarily on the front‑end to label open trades.
      ui: Object.assign({}, cfg.ui || {}, {
        stampSmartExit: cfg.ui?.stampSmartExit !== false,
      }),
    };
  },
};


  export const getChatIdFromCookie = () => {
    return Cookies.get("chatId") || "default";
  };

  const App = () => {
  const { activeWallet, isProtected, loading: userLoading } = useUser();
  const { prefs } = useUserPrefs();

  const userCtx = useUser();
  console.log("🧠 UserContext contents:", userCtx);

  
  useEffect(() => {
    // Always attempt to load preferences using cookies for auth.  We no longer gate this on a localStorage token since authentication happens via HttpOnly cookies.  
    // getPrefs will send the cookie and CSRF token automatically via authFetch.
    const chatId = getChatIdFromCookie();
    getPrefs(chatId).then((prefs) => {
      console.log("✅ Loaded user prefs from cookie:", prefs);
    });
  }, []);

useEffect(() => {
  const loadProfile = async () => {
    const profile = await getUserProfile();
    if (profile?.activeWallet?.publicKey) {
      console.log("🚀 Loaded user profile:", profile);
      console.log("👛 Active wallet:", profile.activeWallet);
      //  SET selectedWallets early, once only
      setSelectedWallets([profile.activeWallet.publicKey]);
      //  FETCH balance right away
      fetchWalletBalance(profile.activeWallet.publicKey); } };
  loadProfile();}, []);


const navigate = useNavigate();
const location = useLocation();
const currentPath = location.pathname.split("/").pop(); // e.g., 'wallets'

  useSingleLogsSocket(); // initializes once on mount
  const [selectedModes, setSelectedModes] = useState(() => {
  try { const stored = localStorage.getItem("selectedModes");
    return stored ? JSON.parse(stored) : []; } catch {
    return []; } });
  /** All live bot instances { botId, mode } */
  const [runningBots, setRunningBots] = useState([]);   // NEW
  const running = Array.isArray(runningBots) && runningBots.length > 0;
  const [confirmed, setConfirmed] = useState(false);
  const [autoRestart, setAutoRestart] = useState(() => {
  try {
    const stored = localStorage.getItem("autoRestart");
    return stored ? JSON.parse(stored) : false;
  } catch {
    return false;} });
  const [loading, setLoading] = useState(false);
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [targetToken, setTargetToken] = useState(() => {
    return localStorage.getItem("targetToken") || null; });
  const [selectedWallets, setSelectedWallets] = useState(() => {
  try { const stored = localStorage.getItem("selectedWallets");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return []; } });

  useEffect(() => {
  if (selectedWallets.length > 0) {
    fetchWalletBalance(selectedWallets[0]);   // immediately fetch
  }
}, [selectedWallets]);    
  const [selectedWalletBalance, setSelectedWalletBalance] = useState(0);
  const [lastBalanceUpdate, setLastBalanceUpdate] = useState(null);
  const [balanceGlow, setBalanceGlow] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [logTarget,   setLogTarget]   = useState(null); // <- botId we care about
  const [showMiniConsole, setShowMiniConsole] = useState(false); 
  const [logsOpen, setLogsOpen] = useState(false); 
  const [activeLogsBotId, setActiveLogsBotId] = useState(false);
  const [activeLogsStrategy, setActiveLogsStrategy] = useState(false); 
  const [logsByBotId, setLogsByBotId] = useState({}); 
  const [isBotStatusOpen, setIsBotStatusOpen] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [beaconBots, setBeaconBots] = useState([]);
  const [returnToStatusModal, setReturnToStatusModal] = useState(false);
  const [sheetTab, setSheetTab] = useState("logs");

  /* keep Beacon in-sync with whatever BotStatusModal knows */
/* Keep Beacon in-sync with BotStatusModal full info */
useEffect(() => {
  if (Array.isArray(statusData?.botIds) && statusData.botIds.length > 0) {
    setBeaconBots(
      statusData.botIds.map((id) => ({
        botId: id,
        mode : statusData.botCfgs?.[id]?.mode || "unknown",
        startTime     : statusData.botCfgs?.[id]?.startTime      ?? Date.now(),
        tradesExecuted: statusData.botCfgs?.[id]?.tradesExecuted ?? 0,
        maxTrades     : statusData.botCfgs?.[id]?.maxTrades      ?? null,
        isPaused      : statusData.botCfgs?.[id]?.isPaused       ?? false,
      }))
    );
  } else {
    // 🧹 No bots reported → clear the beacon list
    setBeaconBots([]);
  }
}, [statusData]);

/* 🔄 Merge runningBots into Beacon list if new ones appear */
useEffect(() => {
  if (!Array.isArray(runningBots) || runningBots.length === 0) return;

  setBeaconBots((prevRaw) => {
    const prev = Array.isArray(prevRaw) ? prevRaw : [];
    const merged = [...prev];

runningBots.forEach((b) => {
  if (!b?.botId) {
  console.warn("⚠️ Skipping malformed bot entry:", b);
  return;
}

  if (!merged.some((m) => m?.botId === b.botId)) {
    merged.push({
      ...b,
      startTime     : Date.now(),
      tradesExecuted: 0,
      maxTrades     : null,
      isPaused      : false,
    });
  }
});

    return merged;
  });
}, [runningBots]);



const massageStatus = (raw) => {
  const botIds = [];
  const botCfgs = {};

  Object.entries(raw).forEach(([botId, info]) => {
    botIds.push(botId);
    botCfgs[botId] = {
      ...info,
      botId,
      isPaused: info.isPaused ?? false, // ← THIS LINE MATTERS
    };
  });

  return { botIds, botCfgs };
};

// 3️⃣ Define refetch BEFORE openBotStatusModal
const refetchStatus = async () => {
  try {
    const upd = await fetchDetailedStatus();
    setStatusData(massageStatus(upd));
  } catch (err) {
    toast.error("❌ Failed to refresh status");
    console.error(err);
  }
};

const openBotStatusModal = async () => {
  try {
    const first = await fetchDetailedStatus();
    setStatusData(massageStatus(first));
    setIsBotStatusOpen(true);

    setTimeout(refetchStatus, 1500);
  } catch (err) {
    toast.error("❌ Failed to fetch bot status");
    console.error(err);
  }
};


const addConsoleLog = ({ botId, level, line }) => {
  const ts        = new Date().toLocaleTimeString([], { hour12: false });
  const formatted = `[${ts}] ${line.trim()}`;

  /* mini-console: only show the bot we’re currently watching */
  if (!logTarget || botId === logTarget) {
    setConsoleLogs((prev) => [...prev.slice(-100), formatted]);
  }

  /* full-sheet: keep a ring-buffer per bot (≤ 1 000 lines) */
  setLogsByBotId((prev) => ({
  ...prev,
  // keep the last 5 000 lines (≈ hours of output)
  [botId]: [...(prev[botId] ?? []).slice(-4999), formatted],
  }));
  //  Auto-open if not open
};

/* helper for the Sheet’s Clear-Logs button */
const clearLogsForBot = (id) =>
  setLogsByBotId(prev => ({ ...prev, [id]: [] }));

const handleSetLogsTarget = ({ botId, strategy, config, returnAfter }) => {
  console.log("🔍 Setting log target from ViewFullRunningModal");
  setReturnToStatusModal(!!returnAfter);   // remember origin
  setSelectedModes([strategy]);
  if (config) setConfig(config);
  setShowMiniConsole(true);
  setLogsOpen(true);
  setLogTarget(botId);
  setIsBotStatusOpen(false);               // hide status modal for now
};


const closeLogsConsole = () => {
  setLogsOpen(false);
  if (returnToStatusModal) {
    setIsBotStatusOpen(true);              // pop the modal back up
    setReturnToStatusModal(false);
  }
};

useEffect(() => {
  const handler = () => openBotStatusModal();
  window.addEventListener("openBotStatusModal", handler);
  return () => window.removeEventListener("openBotStatusModal", handler);
}, []);



useEffect(() => {
  const handler = (e) => handleSetLogsTarget(e.detail);
  window.addEventListener("setLogsTarget", handler);
  return () => window.removeEventListener("setLogsTarget", handler);
}, []);


useEffect(() => {
  if (!import.meta.env.VITE_USE_MOCK_LOGS) return;   // env flag off → no mock
  const id = startMockLogs((line) => addConsoleLog(line));
  return () => clearInterval(id);
}, []);


useEffect(() => {
  fetchBotStatus().then(({ bots }) => setRunningBots(bots)); // bots = [{botId, mode}]
}, []);

useEffect(() => {
  const handle = (e) => {
    const { botId, strategy, config } = e.detail;
    setLogsOpen(true);
    setActiveLogsBotId(botId);
    setActiveLogsStrategy(strategy);
    // only load config if the event actually included one
    if (config) setConfig(config);
  };
  window.addEventListener("setLogsTarget", handle);
  return () => window.removeEventListener("setLogsTarget", handle);
}, []);


const handleClearStratLogs = () => {
  setConsoleLogs([]);
  toast.success("🧠 Strategy console logs cleared.");
};


const fetchInitialNetworth = async () => {
  try {
    const data = await getWalletNetworth();
    const sol = data.tokenValues?.find(t => t.name === "SOL");
    if (sol) setSelectedWalletBalance(parseFloat(sol.amount ?? 0));
  } catch (err) {
    console.error("❌ init net-worth fetch:", err.message);
  }
};


useEffect(() => { fetchInitialNetworth(); }, []);   // ← runs once on page load

  // Config state saved to localStorage
  const [config, setConfig] = useState(() => {
  try {
    const saved = localStorage.getItem("botConfig");
    return saved ? JSON.parse(saved) : {
      slippage: 0.5,
      interval: 3,
      maxTrades: 3,
      useTargetToken: false,
       amountToSpend: 0.05,
    };
  } catch {
    return {
      slippage: 0.5,
      interval: 3,
      maxTrades: 3,
      useTargetToken: false,
       amountToSpend: 0.05,
    }; } });

  const [trades, setTrades] = useState([]);

  
// Fetch trade data on initial load
 useEffect(() => {
   getRecentTrades()
     .then(setTrades)
     .catch((err) => {
       console.error("❌ Trade fetch error:", err);
       toast.error("⚠️ Failed to load trade data.");
     });
 }, []);

// store when it changes
useEffect(() => {
  localStorage.setItem("autoRestart", JSON.stringify(autoRestart));
}, [autoRestart]);


  // Save bot config to localStorage
  useEffect(() => {
    localStorage.setItem("botConfig", JSON.stringify(config));
  }, [config]);

  // Get bot status (running or not)
  // On mount, load all live bot instances
useEffect(() => {
  fetchBotStatus()                       // returns { bots:[ { botId, mode, configPath } ] }
    .then(({ bots }) => setRunningBots(bots))
    .catch((err) => {
      console.error("Error fetching status:", err);
      toast.error("⚠️ Failed to load bot status.");
    });
}, []);

  // Persist Selected Mode
  useEffect(() => {
    localStorage.setItem("selectedModes", JSON.stringify(selectedModes));
  }, [selectedModes]);

  // ⛔ Reset confirmation if config or strategy changes
  useEffect(() => {
    setConfirmed(false);
  }, [config, selectedModes]);

  // Persist auto-restart toggle
  useEffect(() => {
    localStorage.setItem("autoRestart", JSON.stringify(autoRestart));
  }, [autoRestart]);



  /**
   * startMode - launches strategy with current config and mode. 
   */
const startMode = async () => {
  if (userLoading) {
    toast.error("⏳ Still loading user profile…");
    return;
  }
  console.log("🔥 Starting bot with wallet:", activeWallet);
  if (!activeWallet?.id) {
    toast.error("🚫 Cannot start bot – no active wallet.");
    return;
  }
  const singleWalletModes = [ "sniper", "scalper", "breakout", "chadMode", "dipBuyer", "delayedSniper", "trendFollower", "rebalancer", "paperTrader","scheduleLaunch", "turboSniper", ];
    // turboSniper now supports multiple wallets via the multiWallet setting

  const multiWalletError = selectedModes.find(
    (mode) => singleWalletModes.includes(mode) && selectedWallets.length > 1 );
  if (multiWalletError) {
    toast.warning(`🚫 ${multiWalletError} allows only one selected wallet.`);
    setLoading(false);
    return;
  }

const resolvedWallets = selectedWallets.length ? selectedWallets : ["default"];

try {
  for (const mode of selectedModes) {
    /* inject prefs once per mode */
    const cfgWithPrefs = { ...config, _prefs: prefs || {} };

    let rawCfg = CONFIG_BUILDERS[mode]
      ? CONFIG_BUILDERS[mode](cfgWithPrefs, selectedWallets, targetToken, resolvedWallets, activeWallet)
      : buildBaseConfig(cfgWithPrefs, selectedWallets, targetToken, resolvedWallets, activeWallet);

    const finalConfig = sanitizeConfig(rawCfg);
    console.log("🚀 FINAL CONFIG SENT TO API:", { mode, finalConfig, autoRestart });
    const { botId } = await startStrategy(mode, finalConfig, autoRestart);
    setLogTarget(botId);

    setRunningBots(prev => {
      const exists = prev.some((b) => b.botId === botId);
      return exists ? prev : [...prev, { botId, mode }];
    });
    toast.success(`🚀 ${mode} (${botId.slice(-4)}) started.`);
  }
  setShowMiniConsole(true);
} catch (err) {
  toast.error(`❌ ${err.message}${err.details ? " – " + err.details.join(", ") : ""}`); console.error("Start error:", err);
} finally { setLoading(false);
}}



  // stopMode - halts the bot
  const stopMode = async () => {
  setLoading(true); 
  try {
   for (const bot of runningBots) {
     await deleteStrategy(bot.botId);
     toast.warning(`🛑 ${bot.mode} (${bot.botId.slice(-4)}) stopped.`);
   }
   setRunningBots([]);                // clear local state
  } catch (err) {
    toast.error(`❌ Stop error: ${err.message}`);
    console.error("Stop error:", err);
  } finally {
    setLoading(false);
  } 
};

  // Apply strategy filter to trades 
  const visibleTrades = strategyFilter === "all"
  ? trades
  : trades.filter((t) => t.strategy === strategyFilter);


const fetchWalletBalance = async (pubkey) => {
  try {
    const res = await fetchWalletBalances(typeof pubkey === "string" ? pubkey : { pubkey });
    if (!res) throw new Error("No response");
    setSelectedWalletBalance(Number(res.balance));
    setLastBalanceUpdate(new Date().toLocaleTimeString());
    setBalanceGlow(true);
    setTimeout(() => setBalanceGlow(false), 1000);
  } catch (err) {
    console.error("❌ Wallet balance fetch failed:", err);
    toast.error(`❌ Balance error: ${err.message || "Unknown"}`);
  }
};

useEffect(() => {
  const interval = setInterval(() => {
    if (selectedWallets.length > 0 && selectedWallets[0]) {
      fetchWalletBalance(selectedWallets[0]);
    }
  }, 60000); // every 60s not 600k (600k = 10min)

  return () => clearInterval(interval);
}, [selectedWallets]);


  const handleExportCSV = () => openTradesCsv();


return (
  <div className="glow-bg min-h-screen text-white">
    {/* outer page container -------------------------------------- */}
    <div className="container mx-auto p-6 space-y-6">
      {loading && <div className="spinner" />}

      {/* ── Active-bots banner ─────────────────────────────────── */}
      {running && (
        <div
          className="
            flex items-center justify-between
            rounded-lg border border-emerald-500/50
            bg-emerald-600/10 backdrop-blur-sm px-3 py-1.5
            shadow-[0_0_12px_0_rgba(34,197,94,0.25)]
            text-sm
          "
        >
          {/* left */}
          <div className="flex items-center gap-2">
            <CircleDot size={14} className="text-emerald-400 animate-pulse" />
            <span className="text-emerald-200 font-medium">Active&nbsp;Bots:</span>
            <span className="font-semibold text-white">
              {Array.isArray(runningBots) && runningBots.length > 0 
                ? runningBots.map((b) => `${b.mode}(${b.botId.slice(-4)})`).join(", ")
                : "None"}
            </span>
          </div>

          {/* right – auto-restart chip */}
          {autoRestart && (
            <span className="flex items-center gap-[2px] text-xs font-semibold text-amber-300 bg-amber-500/15 px-2 py-[2px] rounded-full">
              <RefreshCw size={12} className="animate-spin-slow" />
              Auto-Restart
            </span>
          )}
        </div>
      )}

      {/* ── Dashboard panels (card containers) ─────────────────── */}
      {/* Target Token */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow space-y-3">
        <TargetToken
          onMintSelected={(mint) => {
            localStorage.setItem("targetToken", mint);
            setTargetToken(mint);
            setConfig((prev) => ({ ...prev, tokenMint: mint }));
          }}
        />
      </div>

    {/* Wallet Balance */}
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow space-y-3">
    <WalletBalancePanel
      walletKeys={selectedWallets}              
      fetchWalletBalance={fetchWalletBalance}
      onWalletSwitched={(pubkey) => {
        if (!pubkey) return;
        setSelectedWallets([pubkey]);             // keep app-level pubkey in sync
        fetchWalletBalance(pubkey);               // refresh balance immediately
      }}
    />
    </div>

      {/* Config Panel */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow space-y-3">
        <ConfigPanel
          config={config}
          setConfig={setConfig}
           activeWallet={activeWallet}
          // disabled={running}
          running={running}
          onStart={startMode}
          onStop={stopMode}
          selectedWalletBalance={selectedWalletBalance}
          lastBalanceUpdate={lastBalanceUpdate}
          balanceGlow={balanceGlow}
          fetchWalletBalance={fetchWalletBalance}
          selectedModes={selectedModes}
          setSelectedModes={setSelectedModes}
          selectedMode={selectedModes[0] || ""}
          setSelectedMode={(m) => setSelectedModes(m ? [m] : [])}
          selectedWallets={selectedWallets}
          autoRestart={autoRestart}
          setAutoRestart={setAutoRestart}
          consoleLogs={consoleLogs}
          setConsoleLogs={setConsoleLogs}
          showFullConsole={showMiniConsole}
          setShowFullConsole={setShowMiniConsole}
          logsOpen={logsOpen}
          setLogsOpen={setLogsOpen}
          currentBotId={logTarget}
        />
      </div>
    </div>
    {/* sheets / overlays ---------------------------------------- */}
    <Suspense
      fallback={
        <div className="p-4 text-zinc-400 text-sm" role="status" aria-live="polite">
          Loading console…
        </div>
      }
    >
      <LazyStrategyConsoleSheet
        open={logsOpen}
        onClose={closeLogsConsole}
        botId={activeLogsBotId}
        strategy={activeLogsStrategy}
        logs={logsByBotId?.[activeLogsBotId] ?? []}
        onClearLogs={() => clearLogsForBot(activeLogsBotId)}
        currentTab={sheetTab}
        bots={
          Array.isArray(statusData?.botIds) && statusData.botIds.length > 0
            ? statusData.botIds.map((id) => ({
                botId: id,
                mode: statusData?.botCfgs?.[id]?.mode ?? "unknown",
                paused: statusData?.botCfgs?.[id]?.isPaused ?? false,
              }))
            : Array.isArray(runningBots)
            ? runningBots
            : []
        }
        onSwitchBot={({ botId, mode }) => {
          setActiveLogsBotId(botId);
          setActiveLogsStrategy(mode);
          setLogTarget(botId);
        }}
      />
    </Suspense>

    <FloatingBotBeacon
      runningBots={beaconBots}
      onOpenLogs={({ botId, mode }) => {
        setActiveLogsBotId(botId);
        setActiveLogsStrategy(mode);
        setSheetTab("logs");
        setLogsOpen(true);
      }}
      onOpenManageBots={openBotStatusModal}
    />
    

    <Suspense
      fallback={
        <div className="p-4 text-zinc-400 text-sm" role="status" aria-live="polite">
          Loading bot status…
        </div>
      }
    >
      <LazyBotStatusModal
        open={isBotStatusOpen}
        onClose={() => setIsBotStatusOpen(false)}
        data={statusData}
        onRefresh={refetchStatus}
onPause={async (id) => {
  try {
    await pauseStrategy(id);
    setRunningBots(prev =>
  prev.map(bot =>
    bot.botId === id ? { ...bot, isPaused: true } : bot
  )
);
    toast.success("⏸️ paused");
  } catch (err) {
    toast.error("⚠️ Already paused or failed");
    console.warn("Pause error:", err);
  } finally {
    await refetchStatus();
  }
}}

onResume={async (id) => {
  try {
    await resumeStrategy(id);
    setRunningBots(prev =>
  prev.map(bot =>
    bot.botId === id ? { ...bot, isPaused: false } : bot
  )
);
    toast.success("▶️ resumed");
  } catch (err) {
    toast.error("⚠️ Already running or failed");
    console.warn("Resume error:", err);
  } finally {
    await refetchStatus();
  }
}}
      onDelete={async (id) => {
        await deleteStrategy(id);
        toast.success("🗑️ deleted");
        await refetchStatus();
      }}
      onPauseAll={async (ids) => {
        await Promise.all(ids.map((id) => pauseStrategy(id)));
        toast.success("⏸️ All bots paused");
        await refetchStatus();
      }}
      />
    </Suspense>
  </div>
);
}
  

  
export default App;
