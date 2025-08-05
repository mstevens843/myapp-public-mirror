/** ConfigPanel - Frontend config UI for Solana trading bot
 * 
 * Features: 
 * - UI to edit and update strategy config in real-time (slippage, trade interval 
 * - Controlled input fields for live config editing
 * - Dynamically syncs input changes to parent bot state via props
 * - Easily extensible for more advanced settings (TP/SL, monitored tokend, etc.)
 * 
 * - Used inside the both dashboard to allow strategy tuning before or during bot runtime. 
 */

import React, { useState, useEffect, useMemo,  useRef } from "react";
import { logEvent } from "@/utils/logger"; // ✅ Not LogsConsole
import ModeSelector from "./ModeSelector";
import { getPrefs, manualBuy, manualSell, updateTpSl, fetchWalletTokens  } from "@/utils/api";
// import { isValidMintAddress } from "@/utils/solana";
import StrategyConfigLoader from "@/components/Strategy_Configs/StrategyConfigLoader";
import { buildMultiStrategyConfig, launchMultiStrategyBot } from "@/utils/multiLaunch";
import { FaPlayCircle, FaStopCircle } from "react-icons/fa";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { openConfirmModal } from "@/hooks/useConfirm";
import ManualTradeCard from "./ManualTradeCard";
import { motion } from "framer-motion"; // ⬅️ At top of file
import { Info, Save, Bot, BarChart3, ChevronDown,
  Check, } from "lucide-react";
import FieldTooltip from "./ToolTip";
import ConfigModal from "@/components/Strategy_Configs/ConfigModal";
import MultiStrategyConfigModal from "@/components/Strategy_Configs/MultiStrategyConfigModal";
import { Wrench } from "lucide-react";
import BotStatusButton from "@/components/Controls/ConfigPanel/BotStatusButton";
import ScheduleLaunchModal from "../Strategy_Configs/ScheduleLaunchModal"; 
import ManageSchedulesModal from "./Modals/ScheduleManagerModal";
import SavedConfigModal from "./Modals/SavedConfigModal"; 
import { listSavedConfigs,} from "@/utils/autobotApi";
import { scheduleStrategy, cancelSchedule, listSchedules  } from "../../utils/scheduler";
import SafetyToggleRow from "./SafetyToggleRow";
import { differenceInSeconds } from "date-fns"
import { useSchedules } from "@/hooks/useSchedules";   
import MiniConsole from "./ConfigPanel/MiniConsole";
import BotControls from "./ConfigPanel/BotControls";
// Import new StrategyRail with titanium aesthetic
import StrategyRail from "./ConfigPanel/StrategyRail";
import { CalendarClock } from "lucide-react";     
import { DotFilledIcon } from "@radix-ui/react-icons";
import { Listbox } from '@headlessui/react'
import LimitModal from "./Modals/LimitModal";
import { useUserPrefs } from "@/contexts/UserPrefsContext";
import { useUser } from "@/contexts/UserProvider";

import {
  Gauge,
  Timer,
  Hash,
  TrendingDown,
  TrendingUp,
  Wallet,
  CheckCircle
} from "lucide-react";
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import ConfirmModal from "./Modals/ConfirmModal";
import BuySummarySheet from "../Tables_Charts/BuySummarySheet";
import "@/styles/components/ConfigPanel.css";



// ConfigPanel.jsx – full REQUIRED_FIELDS imports
import { REQUIRED_FIELDS as SCALPER_FIELDS }         from "../Strategy_Configs/ScalperConfig";
// import { REQUIRED_FIELDS as BREAKOUT_FIELDS }        from "../Strategy_Configs/BreakoutConfig";
import { REQUIRED_FIELDS as DIP_FIELDS }             from "../Strategy_Configs/DipBuyerConfig";
import { REQUIRED_FIELDS as CHAD_FIELDS }            from "../Strategy_Configs/ChadModeConfig";
import { REQUIRED_FIELDS as ROTATION_FIELDS }        from "../Strategy_Configs/RotationBotConfig";
import { REQUIRED_FIELDS as DELAYED_SNIPER_FIELDS }  from "../Strategy_Configs/DelayedSniperConfig";
import { REQUIRED_FIELDS as REBALANCER_FIELDS }      from "../Strategy_Configs/RebalancerConfig";
import { REQUIRED_FIELDS as STEALTH_FIELDS }      from "../Strategy_Configs/StealthBotConfig";




// ⬇️  NEW helper – converts minutes → “Xh Ym”
const formatMinutes = (mins = 0) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};





const TARGETTABLE = [
  "sniper",
  "delayedSniper",
  "breakout",
  "dipBuyer",
  "trendFollower",
  "chadMode",
];

/* Mapping between strategy keys and their human‑readable labels (with emoji).
   This is used by the StrategyRail to display the currently selected
   strategy in the settings summary row. */
const STRAT_LABEL_MAP = {
  sniper: "🔫 Sniper",
  scalper: "⚡ Scalper",
  breakout: "🚀 Breakout",
  dipBuyer: "💧 Dip Buyer",
  trendFollower: "📈 Trend Follower",
  delayedSniper: "⏱️ Delayed",
  chadMode: "🔥 Chad",
  rotationBot: "🔁 Rotation",
  rebalancer: "⚖️ Rebalancer",
  stealthBot: "🥷 Stealth",
  scheduleLauncher: "🕒 Schedule",
};


/* ───────────────── global user defaults ───────────────── */
const userPrefs        = JSON.parse(localStorage.getItem("userPrefs") || "{}");
const DEFAULT_SLIPPAGE =
  typeof userPrefs.slippage === "number" ? userPrefs.slippage : 1.0;


  const isValidMintAddress = (address) => /^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address);


  const WrenchIcon = Wrench;

  const isStrategyConfigValid = (config) => {
  if (!config) return false;
  return Object.values(config).every(
    (v) => v !== "" && v !== null && v !== undefined
  );
};

/** ConfigPanel displays a form that lets the user configure key trading bot settings.
 * Props: 
 * - config: current config state object
 * - setConfig: function to update config state
 */

/* ---------- helper to open TP/SL modal (stub) ---------- */
function openTpSlModal({ mint, entry }) {
  // TODO: replace with real modal launch
  toast.success(`🔧 TP/SL modal would open for ${mint.slice(0, 4)}… at ${entry}`);
}

let lastBlockedMint = null;   


const ConfigPanel = ({
  config,
  setConfig,
  activeWallet,
  selectedWalletBalance = 0,
  disabled = false,
  running,
  onStart,
  onStop,
  lastBalanceUpdate,
  balanceGlow,
  fetchWalletBalance,
  selectedMode,
  setSelectedMode,
  selectedWallets={selectedWallets},
  selectedModes,
  setSelectedModes,
  autoRestart,
  setAutoRestart,
  consoleLogs, 
  setConsoleLogs, 
  showFullConsole,
  setShowFullConsole, 
  logsOpen,
  setLogsOpen,
  currentBotId = null, 
}) => {

  const [safetyResult, setSafetyResult] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [justSetToken, setJustSetToken] = useState(false);
  const [botLoading, setBotLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
const [confirmResolve, setConfirmResolve] = useState(null);
const [confirmMeta, setConfirmMeta] = useState(null);
// const [logBotId, setLogBotId] = useState(null);
 const [logBotId, setLogBotId] = useState(currentBotId);

  const miniConsoleRef = useRef(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);   // ⏰ toggle
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false); // ⏰ modal
  const [launchISO, setLaunchISO] = useState(null); 
  const [countdown , setCountdown]  = useState(""); 
  const isSniper = (mode) => mode === "sniper";
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify(config));
 const isDirty = running && JSON.stringify(config) !== initialSnapshot;
     const ageMins     = config.maxTokenAgeMinutes ?? 60;         // default 60
  const ageFmt      = formatMinutes(ageMins);                  // e.g. “3h 10m”
  const ageWarn     = ageMins < 15 || ageMins > 120;           // aggressive/lenient?
  const ageCssClass = ageWarn ? "text-orange-400" : "text-indigo-300";
  /* ── whenever the bot stops, refresh the snapshot ── */
 useEffect(() => {
   if (!running) setInitialSnapshot(JSON.stringify(config));
 }, [running, config]);
const { prefs } = useUserPrefs();

const resolved = useRef(false); 

const { activeWalletId } = useUser();


const handleStart = async () => {
  // ❌ setBotLoading(true); ← move this down

  const totalSpend  = parseFloat(config.amountToSpend || 0).toFixed(2);
  const intervalSec = Math.round(config.interval / 1000);
  const stratCount  = multiModeEnabled ? enabledStrategies.length : 1;

  try {
    if (prefs?.confirmBeforeTrade) {
      const confirmed = await new Promise((resolve) => {
        setConfirmMeta({
        strategy     : selectedModes[0], 
         title       : "Confirm Strategy Launch",
          tradeType   : "buy",
          tokenSymbol : config.tokenSymbol,
          inputAmount : config.amountToSpend,
          slippage    : config.slippage,
          config      : modalCfg,
          scheduleISO : scheduleEnabled ? launchISO : null,
          onConfirm   : () => resolve(true),
        });
        setShowConfirm(true);
      });

      if (!confirmed) return; // ❌ No loading state if user cancels
    }

    setBotLoading(true); // ✅ Move here after confirm passes

    if (scheduleEnabled && launchISO) {
      await scheduleStrategy({
        mode        : selectedMode,
        config      : config,
        launchISO   : launchISO,
        targetToken : targetToken || null,
        limit       : limitPrice ? { enabled: true, maxPrice: limitPrice } : null,
      });
      toast.success(`⏰ Bot scheduled for ${new Date(launchISO).toLocaleString()}`);
    } else {
      await onStart();
    }
  } finally {
    setBotLoading(false);
  }
};


const handleStop = async () => {
  setBotLoading(true);
  try {
    await onStop();
  } finally {
    setBotLoading(false);
  }
};





const countFilledFields = (config, requiredKeys) =>
  requiredKeys.filter((key) => {
    const val = config?.[key];
    if (Array.isArray(val)) return val.length > 0; //  Fix: bundles/tokens/wallets
    return val !== "" && val !== null && val !== undefined;
  }).length;



useEffect(() => {
  if (miniConsoleRef.current) {
    miniConsoleRef.current.scrollTop = miniConsoleRef.current.scrollHeight;
  }
}, [consoleLogs]);

useEffect(() => {
  if (miniConsoleRef.current) {
    miniConsoleRef.current.scrollTop = miniConsoleRef.current.scrollHeight;
  }
}, [consoleLogs]);



  /* 🆕 Reset mini-console when we switch to a different bot */
  useEffect(() => {
  if (!logBotId) return;


  const now = new Date();
  const timestamp = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const label = `<div class="text-cyan-400 font-semibold animate-fade-in drop-shadow-[0_0_6px_#22d3ee99]">
    🧠 Started <span class="font-bold">[${logBotId}]</span> at ${timestamp}
  </div>`;
 

  const divider = `<div class="border-t border-dashed border-zinc-600 my-2 opacity-70 animate-fade-in" />`;

  setConsoleLogs([label, divider]);
}, [logBotId]);





  const BASE_FIELDS = ["slippage", "interval", "maxTrades", "amountToSpend"];

const REQUIRED_KEYS = {
  // ─────────────── No extra fields ───────────────
    sniper       : [...BASE_FIELDS, "entryThreshold", "volumeThreshold"], // 6 required
   breakout       : [...BASE_FIELDS, "entryThreshold", "volumeThreshold"], // 6 required
  paperTrader:   BASE_FIELDS,
  // ─────────────── With strategy-specific extras ───────────────
  scalper:       [...BASE_FIELDS, ...SCALPER_FIELDS],
  trendFollower: [...BASE_FIELDS, "entryThreshold", "volumeThreshold"],
  // breakout:      [...BASE_FIELDS, ...BREAKOUT_FIELDS],
  dipBuyer:      [...BASE_FIELDS, ...DIP_FIELDS],
  chadMode:      [...BASE_FIELDS, ...CHAD_FIELDS],
  delayedSniper: [...BASE_FIELDS, ...DELAYED_SNIPER_FIELDS],
 rebalancer:    [ ...REBALANCER_FIELDS, "slippage" ],
  rotationBot:   [ ...ROTATION_FIELDS, "slippage" ,],
  stealthBot:   [ ...STEALTH_FIELDS, "slippage" ,],
  paperTrader: [...BASE_FIELDS, "entryThreshold", "volumeThreshold"],
};

/* ───── helper: list whatever is still blank ───── */
const getMissingFields = () => {
  if (multiModeEnabled) {
    const out = [];
    for (const strat of enabledStrategies) {
      const req  = REQUIRED_KEYS[strat] || [];
      const cfg  = multiConfigs[strat]   || {};
      req.forEach(k => {
        if (cfg[k] === "" || cfg[k] === null || cfg[k] === undefined) {
          out.push(`${strat}:${k}`);
        }
      });
    }
    return out;                 // e.g. ["scalper:entryThreshold", "sniper:amountToSpend"]
  }
  const req = REQUIRED_KEYS[selectedMode] || [];
  return req.filter(k => config[k] === "" || config[k] === null || config[k] === undefined);
};


const STRATEGY_OPTIONS = [
  { value: "sniper",         label: "🔫 Sniper" },
  { value: "scalper",        label: "⚡ Scalper" },
  { value: "breakout",       label: "🚀 Breakout" },
  { value: "chadMode",       label: "🔥 Chad Mode" },
  { value: "dipBuyer",       label: "💧 Dip Buyer" },
  { value: "delayedSniper",  label: "⏱️ Delayed Sniper" },
  { value: "trendFollower",  label: "📈 Trend Follower" },
  { value: "paperTrader",    label: "📝 Paper Trader" },
  { value: "rebalancer",     label: "⚖️ Rebalancer" },
  { value: "rotationBot",    label: "🔁 Rotation Bot" },
   { value: "stealthBot",    label: "🥷 Stealth Bot" },
];



  const [railSelection, setRailSelection] = useState(selectedMode || "sniper");


    // helper to get full “emoji + text” from STRATEGY_OPTIONS by selectedMode
  const selectedOption = STRATEGY_OPTIONS.find((o) => o.value === railSelection);
  const selectedEmojiLabel = selectedOption ? selectedOption.label : "No";
  const [lastBlockedMint, setLastBlockedMint] = useState(null);
  const [multiModeEnabled, setMultiModeEnabled] = useState(false);
  const [isMultiModalOpen, setIsMultiModalOpen] = useState(false);
  const [isSavedConfigModalOpen, setIsSavedConfigModalOpen] = useState(false);
  const [enabledStrategies, setEnabledStrategies] = useState([]);
  const [isAutoscroll, setAutoscroll] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [walletTokens, setWalletTokens] = useState([]);


  const [multiConfigs, setMultiConfigs] = useState({
    sniper: {},
    scalper: {},
    delayedSniper: {},
    trendFollower: {},
    dipBuyer: {},
    rotationBot: {},
    stealthBot: {},
    chadMode: {},
    breakout: {},
  });


useEffect(() => {
  const handler = (e) => {
    setLogBotId(e.detail.botId);
  };
  window.addEventListener("setLogsTarget", handler);
  return () => window.removeEventListener("setLogsTarget", handler);
}, []);

 useEffect(() => { setLogBotId(currentBotId); }, [currentBotId]);

  useEffect(() => {
  if (multiModeEnabled) {
    // Clear the single-mode amount input when switching to multi
    setConfig((prev) => {
      const { amountToSpend, ...rest } = prev;
      return rest;
    });
  }
}, [multiModeEnabled]);

  const toggleStrategy = (strat) => {
    setEnabledStrategies((prev) =>
      prev.includes(strat) ? prev.filter((s) => s !== strat) : [...prev, strat]
    );
  };


    const requiredFieldStatus = useMemo(() => {
  if (multiModeEnabled) {
    let requiredSet = new Set();
    let filledCount = 0;

    for (const strat of enabledStrategies) {
      const required = REQUIRED_KEYS[strat] || [];
      const configBlock = multiConfigs[strat] || {};

      for (const field of required) {
        requiredSet.add(field);
      }

      for (const field of required) {
        const val = configBlock?.[field];
        if (val !== "" && val !== null && val !== undefined) {
          filledCount += 1;
        }
      }
    }

    const uniqueRequired = Array.from(requiredSet);
    return `${filledCount}/${uniqueRequired.length} required fields set`;
  } else {
    const strat = selectedMode;
    const required = REQUIRED_KEYS[strat] || [];
    const configBlock = config || {};
    const filled = countFilledFields(configBlock, required);

    return `${filled}/${required.length} required fields set`;
  }
}, [multiModeEnabled, config, selectedMode, multiConfigs, enabledStrategies]);

  // Determine the user‑friendly label for the currently selected strategy.
  // If there is no entry in the STRAT_LABEL_MAP fallback to the raw key.
  const selectedOptionLabel = STRAT_LABEL_MAP[selectedMode] || selectedMode;

  /**
   * Opens the strategy configuration modal from the strategy rail. In
   * multi‑mode this opens the multi‑strategy modal; otherwise it opens
   * the single‑strategy config modal. This replaces the inline button
   * previously located in the config panel.
   */
  const handleOpenStrategyConfig = () => {
    if (multiModeEnabled) {
      setIsMultiModalOpen(true);
    } else {
      setIsConfigModalOpen(true);
    }
  };





  const [manualBuyAmount, setManualBuyAmount] = useState("");
  const [manualSellPercent, setManualSellPercent] = useState("");
  const [lastBuySummary, setLastBuySummary] = useState(null);
  const [showBuySummary, setShowBuySummary] = useState(false);  // ---- strategy-rail selection
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isScheduleManagerOpen, setIsScheduleManagerOpen] = useState(false);
  const { schedules, refetchSchedules } = useSchedules();   // see §5
    const [tempConfig, setTempConfig] = useState(config);
    const AMOUNT_DISABLED_MODES = ["rotationBot", "rebalancer"];
    const TPSL_DISABLED_MODES   = ["rotationBot", "rebalancer"];

const modalCfg = React.useMemo(() => {
  if (selectedMode === "stealthBot") {
    const { wallets, tokenMint, positionSize,
            slippage, maxSlippage, priorityFeeLamports } = config;
    return { wallets, tokenMint, positionSize,
             slippage, maxSlippage, priorityFeeLamports };
  }
  return { ...config, autoRestart };        // unchanged for other bots
}, [selectedMode, config, autoRestart]);

  const onSafetyChange = (partial) =>
  setConfig((prev) => ({ ...prev, ...partial }));

    useEffect(() => {
  if (isConfigModalOpen) {
    // clone the current config into temp when modal opens
    setTempConfig({ ...config });
  }
}, [isConfigModalOpen]);


useEffect(() => {
  const loadLastConfig = async () => {
    const last = localStorage.getItem("lastStrategy");
    if (!last || multiModeEnabled) return;

    try {
     const arr = await listSavedConfigs();
     const match = arr.find((c) => c.strategy === last);
      if (match) {
        setSelectedMode(last);
        setConfig(match.config);
        console.log("✅ Auto-loaded last used config:", last);
      }
    } catch (err) {
      console.warn("⚠️ Failed to auto-load last config:", err.message);
    }
  };

  loadLastConfig();
}, []);


useEffect(() => {
  if (AMOUNT_DISABLED_MODES.includes(selectedMode)) {
    setConfig(p => ({ ...p, amountToSpend: "" }));
  }
}, [selectedMode]);
useEffect(() => {
  if (TPSL_DISABLED_MODES.includes(selectedMode)) {
    setConfig((p) => ({ ...p, stopLoss: "", takeProfit: "" }));
  }
}, [selectedMode]);



useEffect(() => {
  const handler = (e) => {
    const { mode, config } = e.detail;

    // ✅ Update selected mode and load config
    setSelectedMode(mode);
    setRailSelection(mode);
    setConfig(config);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setMultiModeEnabled(false);

    toast.success(`📥 Loaded ${mode} bot for editing`);
  };

  window.addEventListener("viewBotConfig", handler);
  return () => window.removeEventListener("viewBotConfig", handler);
}, []);




useEffect(() => {
  if (selectedMode === "chadMode") {
    setConfig((prev) => ({
      ...prev,
      slippage: 5, // or 6
    }));
  }
}, [selectedMode]);

useEffect(() => {
  if (multiModeEnabled && enabledStrategies.includes("chadMode")) {
    setMultiConfigs((prev) => ({
      ...prev,
      chadMode: {
        ...prev.chadMode,
        slippage: 5, // or 6
      },
    }));
  }
}, [multiModeEnabled, enabledStrategies]);


useEffect(() => {
  if (activeWalletId) {
    setConfig((prev) => ({
      ...prev,
      walletId: activeWalletId,
    }));
  }
}, [activeWalletId]);

useEffect(() => {
  if (!activeWalletId) {
    console.warn("⚠️ Skipping fetchWalletTokens — no active wallet");
    return;
  }

  console.log("📡 Fetching wallet tokens for:", activeWalletId);
  const fetch = async () => {
    const tokens = await fetchWalletTokens(activeWalletId);
    console.log("✅ Tokens fetched:", tokens);
    setWalletTokens(tokens);
  };
  fetch();
}, [activeWalletId]);


/* ── fixed presets for the interval dropdown ── */
const INTERVAL_PRESETS = [
  { label: "10 sec (test)", ms: 10_000 },
    { label: "30 sec (test)", ms: 30_000 },
  { label: "5 minutes",     ms: 5  * 60_000 },
  { label: "10 minutes",    ms: 10 * 60_000 },
  { label: "15 minutes",    ms: 15 * 60_000 },
  { label: "30 minutes",    ms: 30 * 60_000 },
  { label: "60 minutes",    ms: 60 * 60_000 },
  { label: "2 hours",       ms: 2  * 60 * 60_000 },
  { label: "4 hours",       ms: 4  * 60 * 60_000 },
  { label: "8 hours",       ms: 8  * 60 * 60_000 },
  { label: "24 hours",      ms: 24 * 60 * 60_000 },
];


const getIntervalKey = (mode) =>
  mode === "rebalancer"
    ? "rebalanceInterval"
    : mode === "rotationBot"
    ? "rotationInterval"
    : "interval";

const getTradesKey = (mode) =>
  mode === "rebalancer"
    ? "maxRebalances"
    : mode === "rotationBot"
    ? "maxRotations"
    : "maxTrades";

const slippagePct = config?.slippage != null ? Number(config.slippage).toFixed(2) : "—";

// ---- simple field error map  { fieldName : "msg" }
const [errors, setErrors] = useState({})
  const [swapOpts, setSwapOpts] = useState({
    slippage: DEFAULT_SLIPPAGE,
    priorityFee: null,
    enableTPSL: false,
    tp: null,
    sl: null,
  });
  /* highlight cog if user changed anything */
  const overrideActive =
    swapOpts.slippage    !== DEFAULT_SLIPPAGE ||
    swapOpts.priorityFee != null              ||
    swapOpts.enableTPSL  ||
    (swapOpts.tp != null || swapOpts.sl != null);

  /** 🔧 read slippage (and whatever else you store) once per render */

const tradeOpts = {
   walletId   : activeWallet?.id,
  slippage   : swapOpts.slippage ?? prefs?.slippage ?? DEFAULT_SLIPPAGE,
  priorityFee: swapOpts.priorityFee,
};

  /* 🆕 user-level prefs (slippage, autoBuy, confirmBeforeTrade) */
  // const [prefs, setPrefs] = useState(null);

  // useEffect(() => {
  //   getPrefs("default").then(setPrefs).catch(() => setPrefs({}));
  // }, []);

  




const requiresExtraConfig = (mode) =>
  ["breakout", "rotationBot", "rebalancer", "trendFollower", "chadMode", "dipBuyer", "delayedSniper", "scalper", "sniper", "stealthBot", "paperTrader"].includes(mode);


const handleTpSlChange = (e) => {
  const { name, value } = e.target;
  const numeric = parseFloat(value);

  setConfig((prev) => {
    const updated = { ...prev, [name]: value === "" ? "" : numeric };

    if (name === "takeProfit" && numeric !== "") {
      updated.tpPercent = prev.tpPercent ?? 100;
    }
    if (name === "stopLoss" && numeric !== "") {
      updated.slPercent = prev.slPercent ?? 100;
    }

    return updated;
  });
};

  const handleChange = (e) => {
  const { name, value } = e.target;
  const numeric = parseFloat(value);

  if (multiModeEnabled) {
    const activeStrategy = railSelection;
    setMultiConfigs((prev) => ({
      ...prev,
      [activeStrategy]: {
        ...(prev[activeStrategy] || {}),
   [ name === "interval"
     ? getIntervalKey(activeStrategy)
     : name === "maxTrades"
     ? getTradesKey(activeStrategy)
     : name ]: value,
      },
    }));
  } else {
    // existing logic for single mode
    if (name === "amountToSpend") {
      if (numeric > 99) {
        toast.warn("⚠️ That's a lot of SOL! Make sure you're not over-leveraging.");
      }

      if (numeric > selectedWalletBalance) {
        toast.error("❌ You don’t have that much SOL.");
        setErrors(prev => ({ ...prev, amountToSpend: "Exceeds wallet balance" }));
      } else {
        setErrors(prev => { const { amountToSpend, ...rest } = prev; return rest; });
      }
    }

 setConfig((prev) => ({
   ...prev,
   [getIntervalKey(selectedMode)]: name === "interval" ? value : prev[getIntervalKey(selectedMode)],
   [getTradesKey(selectedMode)]  : name === "maxTrades" ? value : prev[getTradesKey(selectedMode)],
   // fallback for all other fields
   ...(name !== "interval" && name !== "maxTrades" ? { [name]: value } : {}),
 }));
  }

  logEvent("CONFIG_CHANGE", { field: name, value });
};

  const handleUseMax = () => {
    if (!selectedWalletBalance) return;
    const maxSpend = Math.max(selectedWalletBalance - 0.02, 0).toFixed(3);
    setConfig((prev) => ({ ...prev, amountToSpend: maxSpend }));
    toast.success(`🔋 Using ${maxSpend} SOL (leaving 0.02 for fees)`);
  };




const handleManualBuy = async (rawAmt) => {
  if (!config.tokenMint) {
    toast.error("❌ Enter a token mint first.");
    return;
  }
  if (config.tokenMint === lastBlockedMint) {
    toast.warn("⛔ This token is blocked due to being untradable. Try another.");
    return;
  }
  const amt = rawAmt ?? prefs?.autoBuy?.amount ?? 0.05;
  const toastId = `cfg-buy-${amt}`;
  toast.loading(`🔫 Buying ${amt} SOL…`, { id: toastId });
  try {
    const res = await manualBuy(amt, config.tokenMint, {
      ...tradeOpts,
      tp: swapOpts.tp,
      sl: swapOpts.sl,
      tpPercent: swapOpts.tpPercent ?? 100,
      slPercent: swapOpts.slPercent ?? 100,
    });
    setLastBlockedMint(null);
    toast.success(
      <span>
        ✅ Buy executed —{" "}
        <a
          href={`https://explorer.solana.com/tx/${res.tx}?cluster=mainnet-beta`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          View&nbsp;Tx
        </a>
      </span>,
      { id: toastId, duration: 9000 }
    );
    setJustSetToken(true);
    setTimeout(() => setJustSetToken(false), 3000);
    setLastBuySummary(res);
    setShowBuySummary(true);

    if (typeof fetchOpenTrades === "function") await fetchOpenTrades();
  } catch (err) {
    if (err.message === "not-tradable") {
      setLastBlockedMint(config.tokenMint);
      toast.error("🚫 This token isn’t tradable on Jupiter.", { id: toastId });
      return;
    }
    toast.error(`❌ Buy failed: ${err.message}`, { id: toastId });
    console.error(err);
  }
};



const shortenedToken = (mint) =>
  `${mint.slice(0, 4)}…${mint.slice(-4)}`;

// Provide richer descriptions for each bot strategy. Keeping tooltips
// concise yet descriptive helps users understand the purpose of each
// bot without overwhelming them. These descriptions draw on best
// practices from trading UX research emphasising informative onboarding
// and frictionless feature discovery【387607645960240†L203-L214】.
const getStrategyHint = (mode) => (
  {
    sniper: "Automatically buys tokens the moment they list, giving you first‑mover advantage.",
    scalper: "Executes rapid trades on trending tokens to capture small, quick profits.",
    breakout: "Enters positions when price and volume spike to ride breakout momentum.",
    dipBuyer: "Watches for sharp price drops and buys into dips to profit on rebounds.",
    chadMode: "Aggressive momentum strategy that trades without hesitation — no brakes.",
    delayedSniper: "Delays the sniper entry after a listing to avoid early volatility.",
    trendFollower: "Buys tokens when price and volume trends align, following momentum.",
    rebalancer: "Keeps your portfolio balanced by periodically adjusting token allocations.",
    rotationBot: "Cycles through tokens based on timing and volume to capture market rotations.",
    paperTrader: "Simulates trades with no real funds — perfect for testing strategies.",
    stealthBot: "Splits your SOL across wallets for discreet accumulation of a single token.",
  }[mode] || "Bot strategy description unavailable"
);
  

const handleManualSell = async (pct) => {
  if (!config.tokenMint) {
    toast.error("❌ Enter a token mint first.");
    return;
  }

  const toastId = `cfg-sell-${pct}`;
  toast.loading(`🔁 Selling ${pct}% of ${config.tokenMint.slice(0, 4)}…`, {
    id: toastId,
  });

  try {
    const res = await manualSell(pct, config.tokenMint, tradeOpts);  // ✅ now includes walletId
    const explorer = `https://explorer.solana.com/tx/${res.tx}?cluster=mainnet-beta`;

    toast.success(
      <span>
        ✅ Sold {pct}% —{" "}
        <a
          href={explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          View&nbsp;Tx
        </a>
      </span>,
      { id: toastId, duration: 25000 }
    );

    if (typeof fetchOpenTrades === "function") await fetchOpenTrades(); // 🧼 refresh trades
  } catch (err) {
    toast.error(`❌ Sell failed: ${err.message}`, { id: toastId });
    console.error(err);
  }
};
// const isStartDisabled = (
//   !config.tokenMint ||
//   !config.slippage || isNaN(config.slippage) || Number(config.slippage) <= 0 ||
//   !config.interval || isNaN(config.interval) || Number(config.interval) <= 0 ||
//   !config.maxTrades || isNaN(config.maxTrades) || Number(config.maxTrades) <= 0 ||
//   !config.amountToSpend || isNaN(config.amountToSpend) || Number(config.amountToSpend) <= 0 ||
//   (multiModeEnabled && enabledStrategies.some((s) => !isStrategyConfigValid(multiConfigs[s])))
// );

// ⏰ block start if a schedule is pending for this mode

const [hasSchedule, setHasSchedule] = useState(false);

// ─── track active schedule + tick countdown ──────────────────────────────
useEffect(() => {
  if (!open) return;

  let intervalId;
  let consecutiveFails = 0;

  const poll = async () => {
    try {
      const { jobs } = await listSchedules();
      const active = jobs.find((j) => j.mode === selectedMode);
      setHasSchedule(!!active);

      if (active) {
        const secs = differenceInSeconds(new Date(active.launchISO), new Date());
        setCountdown(secs <= 0 ? "now" : `${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        setCountdown("");
      }

      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails++;
      if (consecutiveFails >= 5) {
        console.warn("⛔ Stopping poller after 5 failures.");
        clearInterval(intervalId);
      }
    }
  };

  poll(); // initial call
  intervalId = setInterval(poll, 120000);

  return () => clearInterval(intervalId);
}, [selectedMode, scheduleModalOpen, open]);

const isStartDisabled = getMissingFields().length > 0;

function blockNegatives(e, cb) {
  // Fix crash from destructuring on null event
  if (!e?.target || typeof e.target.name !== "string") return;

  const { name, value } = e.target;

  // Allow clearing input (backspace/delete)
  if (value === "") {
    cb?.(e);
    return;
  }

  // Stop if trying to type a minus in disallowed fields
  const allowNegative = name === "stopLoss";
  if (!allowNegative && value.includes("-")) {
    return; // Don't update state
  }

  // Valid input, allow change
  cb?.(e);
}


const extraConfig = multiModeEnabled
  ? multiConfigs[railSelection] || {}
  : config;
const isExtraConfigEmpty = Object.keys(extraConfig || {}).length === 0;

const CARD = "rounded-xl border border-zinc-700 \
bg-gradient-to-br from-zinc-900/90 via-zinc-900/80 to-zinc-900/60 \
backdrop-blur-md";
    return (
       <motion.div
    className="space-y-8"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
  >
    {/* Outer container for manual trade and strategy rail – metallic gradient */}
    <div className="rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-700 shadow-inner hover:shadow-emerald-800/10 transition-shadow">
      {/* ───────────────── Quick Manual Trade Card ───────────────── */}

      <ManualTradeCard
        config={config}
        prefs={prefs}
        swapOpts={swapOpts}
        setSwapOpts={setSwapOpts}
        selectedWalletBalance={selectedWalletBalance}
        disabled={disabled}
        safetyResult={safetyResult}
        handleManualBuy={handleManualBuy}
        handleManualSell={handleManualSell}
        manualBuyAmount={manualBuyAmount}
        setManualBuyAmount={setManualBuyAmount}
        manualSellPercent={manualSellPercent}
        setManualSellPercent={setManualSellPercent}
        handleUseMax={handleUseMax}
        overrideActive={overrideActive}
        lastBlockedMint={lastBlockedMint}
        setLastBlockedMint={setLastBlockedMint}
  walletId={activeWallet?.id}
      />
      {console.log("🪵 activeWallet", activeWallet)}



             {/* ╭──────────────── Strategy Rail ────────────────╮ */}

<div className="flex gap-4 mt-10">
{/* <div className="flex gap-4 rounded-lg p-4 border border-zinc-800 bg-zinc-900 overflow-x-auto scrollbar-none max-w-full"> */}
<StrategyRail
  multiModeEnabled={multiModeEnabled}
  enabledStrategies={enabledStrategies}
  toggleStrategy={toggleStrategy}
  railSelection={railSelection}
  setRailSelection={setRailSelection}
  setSelectedMode={setSelectedMode}
  onScheduleClick={() => setScheduleModalOpen(true)}
  requiredFieldStatus={requiredFieldStatus}
  selectedMode={selectedMode}
  selectedOptionLabel={selectedOptionLabel}
  onOpenConfig={handleOpenStrategyConfig}
/>
  {/* ────────────── Config Section ────────────── */}
<div className="flex flex-col md:flex-row pb-6 gap-0 w-full">

  {/* Strategy selection rail + config layout */}
<motion.div
  key={multiModeEnabled ? "multi" : "single"}
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -8 }}
  transition={{ duration: 0.25 }}
  className="flex w-full gap-6"
>    


    {/* ───── Config Content ───── */}
    {/* Config card container – apply metallic gradient */}
    <div className="rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-700 shadow-inner hover:shadow-indigo-800/10 transition-shadow">



      <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-5">
  {/* Left: Title and hint */}
  <div className="flex flex-col">
    <h2 className="text-xl font-bold text-white flex items-center gap-2">
      {multiModeEnabled
        ? "🧠 Multi-Strategy Mode"
        : `${selectedEmojiLabel} Auto-Bot Configuration`}
    </h2>
    {/* {isDirty && (
  <p className="text-yellow-400 text-xs font-semibold italic mt-1">
    ⚠️ You're editing a bot that's currently running. Changes won't apply until you stop and restart it.
  </p>
)} */}

    {!multiModeEnabled && (
<div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-1 mt-1 w-fit">
  {getStrategyHint(selectedMode)}
</div>
    )}
  </div>
    {/*  <p className="text-xs text-zinc-500 italic mt-[2px]">
        {getStrategyHint(selectedMode)}
      </p> */}

{/* ─────────────── TOP CONTROL BAR ─────────────── */}
<div className="flex justify-between items-center gap-4 mb-4 pb-10">

  {/* ⬅️ Mode Toggle */}


  {/* ➡️ Bot Management ToggleGroup */}
  <ToggleGroup.Root type="single" className="flex border space-x-2 border-zinc-700 rounded-md overflow-hidden shadow-inner bg-zinc-800  text-xs font-semibold">
    {/* 🟢 Running Bots */}
    <BotStatusButton
  trigger={
    <div className="px-3 py-2 h-10 transition-all text-zinc-300 hover:text-white hover:bg-zinc-700 
           flex items-center justify-center gap-2 animate-pulse bg-emerald-600/50" >
      <Bot size={16} />
      Running Bots
    </div>
  }
/>

    {/* 💾 Saved Configs */}
    <button
      onClick={() => setIsSavedConfigModalOpen(true)}
className="px-3 py-2 h-10 flex items-center justify-center gap-2 text-zinc-300 
           hover:text-white hover:bg-zinc-700 hover:shadow-[0_0_6px_#10b98155] transition-all">

      <Save size={14} strokeWidth={2} />
      Saved
    </button>
  {/* NEW — Schedules */}
  <button
    onClick={() => setIsScheduleManagerOpen(true)}
    className="px-3 py-1 flex items-center gap-2 text-zinc-300
               hover:text-white hover:bg-zinc-700 hover:shadow-[0_0_6px_#10b98155] transition-all"
  >
    <CalendarClock size={14} />
    Schedules
    {schedules.length > 0 && (               // 🟠 optional badge
      <span className="ml-1 text-xxs bg-orange-600/60 px-1 rounded">
        {schedules.length}
      </span>
    )}
  </button>
  </ToggleGroup.Root>
</div>
</header>
{/* Config Card Grid + Bot Controls */}
<div className="relative flex flex-col md:flex-row gap-10 p-6 pb-24 rounded-xl 
  bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-700 border border-zinc-700 shadow-inner backdrop-blur
  hover:shadow-emerald-800/10 transition-shadow duration-300">

  {/* Floating summary overlay (replaces right+bottom summaries) */}
{/* <BotSummaryOverlay config={config} /> */}

<div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-9 pl-1 gap-y-10 sm:pr-10 py-1 border-r border-zinc-800">
  {[
    {
      label: "Slippage (%)",
      name:  "slippage",
      placeholder: "e.g. 0.5",
      icon: <Gauge size={16} className="absolute left-2 z-10 text-amber-400 text-amber-400 pointer-events-none" />,
    },
    {
      label:
        selectedMode === "rebalancer"
          ? "Rebalance Interval"
          : selectedMode === "rotationBot"
          ? "Rotation Interval"
          : "Scan Every (sec)",
      name:  "interval",
      placeholder: "e.g. 3.0",
      icon: <Timer         size={16} className="absolute left-2 z-10 text-indigo-400 pointer-events-none" />,
    },
    {
      label:
        selectedMode === "rebalancer"
          ? "Max Rebalances"
          : selectedMode === "rotationBot"
          ? "Max Rotations"
          : "Max Trades",
      name:  "maxTrades",
      placeholder: "e.g. 5",
      icon: <Hash          size={16} className="absolute left-2 z-10 text-blue-400 pointer-events-none" />,
    },
    {
      label: (
        <div className="flex justify-between w-full">
          <span>Stop Loss (%)</span>
          <span className="text-zinc-400 italic text-xs">(Optional)</span>
        </div>
      ),
      name: "stopLoss",
      placeholder: "e.g. -3",
      icon: <TrendingDown size={16} className="absolute left-2 z-10 text-red-400 pointer-events-none" />,
    },
    {
      label: (
        <div className="flex justify-between w-full">
          <span>Take Profit (%)</span>
          <span className="text-zinc-400 italic text-xs">(Optional)</span>
        </div>
      ),
      name: "takeProfit",
      placeholder: "e.g. 5",
      icon: <TrendingUp size={16} className="absolute left-2 z-10 text-green-400 pointer-events-none" />,
    },
    {
      type: "button",
      name: "editStrategyConfig",
      label: multiModeEnabled
        ? "Multi-Strategy Config"
        : `${selectedOption?.label || railSelection} Config`,
    },
].map(({ label, name, placeholder, icon, type }) => {
  // Strategy configuration is now handled via the rail. Skip rendering any
  // inline button field that previously opened the config modal.
  if (type === "button") {
    return null;
  }

   const intervalValue = multiModeEnabled
    ? multiConfigs[railSelection]?.[getIntervalKey(railSelection)] ?? ""
    : config[getIntervalKey(selectedMode)] ?? "";

  return (
    <label key={name} className="flex flex-col text-sm font-medium gap-1 pb-[1px]">
      <div className="flex items-center gap-1">
        {label}
        <FieldTooltip name={name}/>
      </div>

      <div className="relative w-full">
        {/* ICON ALWAYS PRESENT */}
        <span className="absolute left-2 top-2.5 z-10 pointer-events-none">
          {icon}
        </span>

        {/* rebalancer / rotation get the dropdown, everyone else an input */}
        {name === "interval" &&
        ["rebalancer","rotationBot"].includes(selectedMode) ? (

          <Listbox
            value={intervalValue}
            onChange={(value) =>
              handleChange({ target: { name: "interval", value } })
            }
          >
            <div className="relative w-full">
              {/* icon already rendered above */}
              <Listbox.Button
                className="pl-7 pr-10 py-2 w-full bg-zinc-900 border border-zinc-700 rounded-xl text-left
                           text-white shadow-inner hover:border-emerald-500 focus:outline-none focus:ring-2
                           focus:ring-emerald-400 transition"
              >
                {
                  INTERVAL_PRESETS.find(
                    (opt) => String(opt.ms) === String(intervalValue)
                  )?.label || "interval"
                }
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-2.5 text-zinc-400 pointer-events-none"
                />
              </Listbox.Button>

              <Listbox.Options
                className="absolute z-50 mt-1 w-full rounded-md shadow-lg bg-zinc-900 border border-zinc-700
                           py-1 text-white max-h-60 overflow-auto"
              >
                {INTERVAL_PRESETS.map((opt) => (
                  <Listbox.Option
                    key={opt.ms}
                    value={opt.ms}
                    className={({ active }) =>
                      `cursor-pointer px-3 py-1 ${
                        active ? "bg-zinc-700 text-white" : "text-zinc-300"
                      }`
                    }
                  >
                    {({ selected }) => (
                      <div className="flex justify-between items-center">
                        <span>{opt.label}</span>
                        {selected && <Check size={16} className="text-emerald-400"/>}
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>

        ) : (

          <input
            type="text"
            name={name}
            step={name === "amountToSpend" ? "0.001" : "1"}
            placeholder={placeholder}
            value={
              multiModeEnabled
                ? multiConfigs[railSelection]?.[
                    name === "interval"
                      ? getIntervalKey(railSelection)
                      : name === "maxTrades"
                      ? getTradesKey(railSelection)
                      : name
                  ] ?? ""
                : config[
                    name === "interval"
                      ? getIntervalKey(selectedMode)
                      : name === "maxTrades"
                      ? getTradesKey(selectedMode)
                      : name
                  ] ?? ""
            }
            onChange={(e) =>
              ["stopLoss","takeProfit"].includes(name)
                ? handleTpSlChange(e)
                : blockNegatives(e, handleChange)
            }
            disabled={
              disabled ||
              (["stopLoss","takeProfit"].includes(name) &&
               TPSL_DISABLED_MODES.includes(selectedMode)) ||
              (name === "amountToSpend" && AMOUNT_DISABLED_MODES.includes(selectedMode))
            }
            className={`pl-7 pr-8 py-2 w-full rounded-xl text-right bg-zinc-900 border
                        border-zinc-700 placeholder:text-zinc-400 shadow-inner
                        focus:outline-none focus:ring-2 focus:ring-emerald-400
                        hover:border-emerald-500 transition
                        ${
                          ["stopLoss","takeProfit"].includes(name) &&
                          TPSL_DISABLED_MODES.includes(selectedMode)
                            ? "opacity-40 cursor-not-allowed"
                            : ""
                        }`}
          />

        )}
      </div>
    </label>
  );
})}
</div> 

        {/* Bot controls */}
{/* Bot controls */}
<div className="flex flex-col ml-auto pr-2 w-full md:w-[200px] items-end justify-start relative -mt-4 gap-3">
  {/* 🛡️ Safety Toggle */}
  <div className="w-full pb-2">
    <SafetyToggleRow
      cfg={config}
      onChange={onSafetyChange}
      
    />
  </div>

  {/* 💰 Amount (SOL) input */}
  <label className="flex flex-col text-sm font-medium gap-1 min-w-[120px] items-end w-full">
    <div className="flex items-center gap-1 self-end">
      <span>Amount (SOL)</span>
      <img
        src="https://assets.coingecko.com/coins/images/4128/small/solana.png"
        alt="SOL"
        className="w-4 h-4 cursor-pointer hover:scale-105 transition-transform duration-200"
      />
    </div>
    <div className="relative w-full">
      <Wallet size={16} className="absolute left-3 top-2.5  text-emerald-600" />
     <input
        id="bot-amount"
        type="text"
            inputMode="decimal"
        name="amountToSpend"
        value={config.amountToSpend || ""}
        onChange={handleChange}
        placeholder={
          selectedWalletBalance
            ? `bal ${selectedWalletBalance.toFixed(2)} SOL`
            : "0.00"
        }
        disabled={AMOUNT_DISABLED_MODES.includes(selectedMode)}
        className={`pl-4 pr-3 py-2 w-full text-right bg-zinc-800 border
          ${errors.amountToSpend ? "border-red-500" : "border-zinc-600"}
          rounded-md placeholder:text-zinc-400
          focus:outline-none focus:ring-[1.5px]
          ${errors.amountToSpend ? "focus:ring-red-500" : "focus:ring-emerald-400"}
          hover:border-emerald-500 hover:shadow-[0_0_6px_#10b98155]
          transition-all duration-200 ease-in-out
          ${AMOUNT_DISABLED_MODES.includes(selectedMode) ? "opacity-40 cursor-not-allowed" : ""}`}
      />
    </div>
  </label>

  {/* ▶️ Bot Controls */}
  <div className="absolute right-150px top-[150px] ">
    <BotControls
  // disabled={disabled || isStartDisabled}
  disabled={false}
  missing={getMissingFields()}        
  running={running}
  onStart={handleStart}
  onStop={handleStop}
  autoRestart={autoRestart}
  setAutoRestart={setAutoRestart}
  currentMode={selectedMode}
  botLoading={botLoading}
    hasSchedule={hasSchedule}   // ⏰ pass-through
    countdown={countdown}       // ⏰ pass-through
  />
  </div>
</div>
        


{/* ───────────────────────── footer row ───────────────────────── */}
<div className="absolute bottom-[12px] left-4 right-3 flex items-center justify-between text-xs italic">

  {/* ◀️ Toggle group on left side */}
  <div className="flex flex-col gap-[3px] items-start text-zinc-300">

    {/* ① Explanation text */}
    {TARGETTABLE.includes(railSelection) && (
      <>

        {/* ② Toggle + Mint badge on 2nd line */}
        <div className="flex items-center gap-3">
          {config.useTargetToken && config.tokenMint && (
            <span className={`px-2 py-[1px] rounded-full bg-zinc-800 ring-1  text-blue-300  ring-blue-500
                              flex items-center gap-1 ${justSetToken ? "ring-purple-500/30" : ""}`}>
              <img
                src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${config.tokenMint}/logo.png`}
                onError={(e) => (e.target.style.display = "none")}
                alt="token"
                className="w-3 h-3 rounded-full"
              />
              {shortenedToken(config.tokenMint)}
            </span>
          )}
        </div>
      </>
    )}
    {/* ⏰ Dual toggle row  */}
<div className="flex items-center gap-6 mt-1">
  {/* Existing Target Token switch already here */}
<div className="flex items-center gap-2">
  <Switch
    checked={config.useTargetToken || false}
    onCheckedChange={(val) => setConfig((p) => ({ ...p, useTargetToken: val }))}
    disabled={selectedMode === "chadMode"}
  />
  <span className={selectedMode === "chadMode" ? "opacity-50" : ""}>
    {selectedMode === "chadMode"
      ? "🔥 Please input token in Chad config"
      : <>🎯 Limit <strong>{selectedOption?.label?.split(" ")[1]}</strong> to Target Token</>}
  </span>
</div>

  {/* ── Mode-selected pill ── */}
<span
  className={`ml-2 px-2 py-[1px] rounded-full text-emerald-300 bg-emerald-600/20 
              border border-emerald-500 text-[11px] font-medium`}
>
  {running
      ? `${enabledStrategies.length} strategies selected`
      : `${selectedEmojiLabel} mode selected`}
</span>
</div>

  </div>

</div>

</div>
{/* Sleek Toggle Switch – always shown */}
<div className="mt-3 pt-5 text-xs text-zinc-400 italic px-4 flex items-center justify-between rounded-md bg-zinc-900 py-2">
  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer group">
    <span className="text-emerald-400">🖥 Console</span>
    <div className="relative">
      <Switch
        checked={showFullConsole}
        onCheckedChange={setShowFullConsole}
        className={`data-[state=checked]:bg-emerald-500 bg-zinc-700 
                    w-9 h-5 rounded-full relative transition-all duration-300`}
      />
      <div className="absolute bottom-full  mb-1 left-1/2 -translate-x-1/2 z-10 hidden group-hover:block text-xs text-zinc-300 bg-zinc-900 px-2 py-1 rounded border border-zinc-700 shadow-lg whitespace-nowrap">
        Toggle bot log console 
      </div>
    </div>
  </label>

  {/* Bot Summary — conditional */}
  {config.amountToSpend && config.interval && (
    <div className="flex flex-col items-end text-right">
      <p>
        📊 <span className="text-pink-400 font-semibold">Bot Summary</span> — Will spend&nbsp;
        <span className="text-emerald-300 font-semibold">
          {(() => {
            const amt = parseFloat(config.amountToSpend);
             const trades = parseInt(
               config[getTradesKey(selectedMode)] || 1,
               10
             );
            return (amt * (trades || 1)).toFixed(2);
          })()}&nbsp;SOL
        </span>{" "}
        total (&nbsp;
        <span className="text-emerald-300 font-semibold">
          {(+config.amountToSpend || 0).toFixed(2)}
        </span>{" "}
        SOL&nbsp;per&nbsp;trade) every&nbsp;
        <span className="text-indigo-300 font-semibold">
          {(() => {
            const raw = +config[getIntervalKey(selectedMode)];
            const secs = raw >= 1000 ? Math.round(raw / 1000) : raw;
            return `${secs} sec`;
          })()}
        </span>{" "}
         up&nbsp;to&nbsp;
         <span className="text-blue-300 font-semibold">
           {config[getTradesKey(selectedMode)] || "∞"} trades
        </span>
      </p>

      <p>
        TP&nbsp;/&nbsp;SL:&nbsp;
        <span className="text-yellow-300 font-semibold">
          {config.takeProfit ?? "—"}%
        </span>{" "}
        /{" "}
        <span className="text-red-300 font-semibold">
          {config.stopLoss ?? "—"}%
        </span>
      </p>

      {Number.isFinite(+config.maxTokenAgeMinutes) && +config.maxTokenAgeMinutes > 0 && (
        <p>
          ⏱ Max&nbsp;Token&nbsp;Age:&nbsp;
          <span className="font-semibold text-rose-300">
            {+config.maxTokenAgeMinutes}m
          </span>
        </p>
      )}

      {(config.minMarketCap || config.maxMarketCap) && (
        <p>
          💰 Market&nbsp;Cap:&nbsp;
          {config.minMarketCap && (
            <>
              <span className="text-orange-300 font-semibold">
                ≥ ${(+config.minMarketCap).toLocaleString()}
              </span>
              {config.maxMarketCap && " / "}
            </>
          )}
          {config.maxMarketCap && (
            <span className="text-orange-300 font-semibold">
              ≤ ${(+config.maxMarketCap).toLocaleString()}
            </span>
          )}
        </p>
      )}

      {scheduleEnabled && launchISO && (
        <p>
          📅 Launches&nbsp;
          <span className="text-emerald-300 font-semibold">
            {new Date(launchISO).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>{" "}
          ·{" "}
          {new Date(launchISO).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}
    </div>
  )}
</div>

{/* MiniConsole – always shown */}
<MiniConsole
  show={showFullConsole}
  consoleLogs={consoleLogs}
  isAutoscroll={isAutoscroll}
  setAutoscroll={setAutoscroll}
  setConsoleLogs={setConsoleLogs}
  setLogsOpen={setLogsOpen}
  logBotId={logBotId}
  currentBotId={currentBotId}
  selectedMode={selectedMode}
  config={config}
/>

    </div>
  </motion.div>  {/* ✅ CLOSE HERE */}


        {/* ────────── Action Cluster ────────── */}
        <div className="flex flex-col items-center gap-4 mt-8 md:mt-0 md:ml-6 md:self-start">
          {/* Amount (SOL) input + floating label */}
        </div>
        </div>



          <MultiStrategyConfigModal
            open={isMultiModalOpen}
            onClose={() => setIsMultiModalOpen(false)}
            onSave={() => setIsMultiModalOpen(false)}
            selectedStrategies={enabledStrategies}
            multiConfigs={multiConfigs}
            setMultiConfigs={setMultiConfigs}
            disabled={disabled}
          />
        </div>
        </div>
{isConfigModalOpen && (
  <>
    {console.log("🧠 <ConfigPanel> passing walletTokens:", walletTokens)}

    <ConfigModal
      open={isConfigModalOpen}
      strategy={selectedOption?.label}
      config={tempConfig}
      setConfig={setTempConfig}
      onSave={(finalConfig) => {
        setConfig(finalConfig);
        setIsConfigModalOpen(false);
      }}
      onClose={() => setIsConfigModalOpen(false)}
      disabled={disabled}
    >
      <StrategyConfigLoader
        strategy={selectedMode}
        config={tempConfig}
        setConfig={setTempConfig}
        disabled={disabled}
        walletTokens={walletTokens}
      />
    </ConfigModal>
  </>
)}
    <SavedConfigModal
  open={isSavedConfigModalOpen}
  onClose={() => setIsSavedConfigModalOpen(false)}
  mode={selectedMode}
  currentConfig={config}
  onLoad={(cfg) => setConfig(cfg)}
  setSelectedMode={setSelectedMode}
/>

{showConfirm && confirmMeta && (
  <ConfirmModal
    {...confirmMeta}
    onResolve={(ok) => {
      setShowConfirm(false);
      if (ok && confirmMeta?.onConfirm) {
        confirmMeta.onConfirm(); // ← your bot start logic here
      }
    }}
  />
)}

<BuySummarySheet
  open={showBuySummary}
  onClose={() => setShowBuySummary(false)}
  summary={lastBuySummary}
/>
{scheduleModalOpen && (
  <ScheduleLaunchModal
    open={scheduleModalOpen}
    onClose={() => {
      setScheduleModalOpen(false);
      setScheduleEnabled(false);
    }}
    onConfirm={(iso) => {
      setLaunchISO(iso);
      setScheduleModalOpen(false);
    }}
  />
)}

<LimitModal
  open={isLimitModalOpen}
  onClose={() => setIsLimitModalOpen(false)}
  walletId={activeWallet?.id}     // ✅ or selectedWallet?.id
/>

    <ManageSchedulesModal
      open={isScheduleManagerOpen}
      onClose={() => setIsScheduleManagerOpen(false)}
      onEdit={(job) => {
        setScheduleModalOpen(true);
        // preload modal with existing values
        setLaunchISO(job.launchISO);
        setEditJob(job);                     // optional: hold jobId if you want /update
      }}
    />
        </motion.div>
      );
    };

    export default ConfigPanel;
