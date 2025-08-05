/* ============================================================
 * ScheduleLaunchModal.jsx – v3.1, “Glow” redesign 🟣🟢
 * ------------------------------------------------------------
 * • Dual-mode buys  ✅ Interval | ✅ Limit
 * • Tool-tips on every input + mode selector (inline component)
 * • Dark-glow aesthetic (matches TelegramTab)
 * • GlowButton helper for consistent buttons
 * • BASIC / ADVANCED sections (collapsible)
 * • Live launch preview (local time string) at top
 * • Strict focus-ring / shadow styles for inputs
 * ========================================================== */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarClock,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Info,
  Shield,
  Zap,
} from "lucide-react";
import { useMemo, useState, useEffect, } from "react";
import { DayPicker } from "react-day-picker";
import { setHours, setMinutes } from "date-fns";
import "react-day-picker/dist/style.css";
import { Listbox } from "@headlessui/react";
import { scheduleStrategy } from "@/utils/scheduler"; 
import { toast } from "sonner";
import { useUser } from "@/contexts/UserProvider";
import { useUserPrefs } from "@/contexts/UserPrefsContext";
import { getSolPrice } from "../../utils/solPrice";
const CONFIG_BUILDERS = {
  scheduleLauncher: (cfg) => {
    return {
      buyMode: cfg.buyMode,
      amountToSpend: cfg.amountToSpend,
      maxTrades: cfg.maxTrades,
      slippage: cfg.slippage,
      mevMode: cfg.mevMode,
      ...(cfg.priorityFeeLamports !== undefined && {
        priorityFeeLamports: cfg.priorityFeeLamports,
      }),
      ...(cfg.takeProfit !== undefined && {
        takeProfit: cfg.takeProfit,
        tpPercent: 100,
      }),
      ...(cfg.stopLoss !== undefined && {
        stopLoss: cfg.stopLoss,
        slPercent: 100,
      }),
      ...(cfg.buyMode === "interval" && {
        interval: cfg.interval,
      }),
      ...(cfg.buyMode === "limit" && {
        limitConfigs: cfg.limitConfigs,
      }),
    };
  },
};

/* ——— inline StrategyTooltip ——— */
function StrategyTooltip({ name, text }) {
  /* lookup table kept VERY small – only what this modal needs */
  const lookup = {
    intervalMode:
      `**Interval Mode** — the bot slices your _Total Spend_ into equal-sized chunks\n` +
      `and fires a market buy every *Interval (seconds)* until *# of Buys* is reached.\n\n` +
      `Example: 3 SOL ÷ 3 buys with 30 s interval → 1 SOL every 30 s.`,
    limitMode:
      `**Limit Mode** — pre-defines [Price, Amount] pairs. The bot watches the market\n` +
      `and executes the buy as soon as the token’s price ≤ your *Limit Price*. Supports\n` +
      `multiple tiers so you can ladder entries (DCA) down the order book.`,
      limitPrice: "Price (in **USD**) that must be met or beaten before the bot buys.",
    limitAmount: "Amount to spend (USD) when this limit-price condition is hit.",
    minPriceFloor: "Skip any execution if live price is BELOW this floor (works in both modes).",
    totalSpend:
      "How much SOL the schedule may spend *in total* across all buys.",
    maxTrades: "Total number of buys this schedule will attempt.",
    intervalSeconds: "Time-gap between buys when using **Interval Mode**.",
    limitPrice: "Price (in SOL) that must be met or beaten before the bot buys.",
    limitAmount: "SOL to spend when this limit-price condition is hit.",
    slippage: "Max % price impact tolerated on each buy.",
    takeProfit: "If set – bot will auto-sell *full* position at this SOL price.",
    stopLoss: "If set – bot will auto-sell *full* position at this SOL price.",
    priorityFee: "Extra lamports per tx to bribe validators (higher = faster).",
    mevMode:
      "`fast` = minimum CU, quickest inclusion.\n`secure` = bundles + tip for MEV protection.",
  };

  const content = text || lookup[name] || "ℹ️  Tooltip coming soon.";

  return (
    <div className="relative group flex items-center">
      <Info
        size={14}
        className="ml-1 text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div
        className="absolute right-5 top-[-4px] z-20 hidden group-hover:block
                    bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600
                    max-w-[240px] w-max shadow-lg whitespace-pre-line"
      >
        {content}
      </div>
    </div>
  );
}

/* ——— glow-button helper ——— */
const GlowButton = ({
  children,
  variant = "primary",
  disabled,
  onClick,
  className = "",
}) => {
  const styles = {
    primary:
      "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500",
    secondary:
      "bg-purple-600 hover:bg-purple-700 focus:ring-purple-500",
    danger: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
    ghost: "bg-transparent border border-zinc-600 hover:border-zinc-400",
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium
        text-white shadow-md hover:shadow-emerald-600/20 transition focus:outline-none focus:ring-2
        disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

/* ——— helpers ——— */
const num = (v) => (v === "" ? undefined : +v);

/* ——— NEW: local-to-UTC helper ——— */
/* ——— FIXED: local-to-UTC helper ———
   A JavaScript Date already carries your local offset.
   Calling .toISOString() converts it to a proper UTC string.
   The extra manual subtraction was **double-shifting** the time by your offset,
   which is why 23:21 local became 16:21 UTC in the DB.
+*/
const toUtcIso = (localDate) => localDate.toISOString();


export default function ScheduleLaunchModal({
  open, onClose, onConfirm,
  initial = {},            // ← carries jobId when editing
  isEdit = false,
  userTimezone,
}) {
  const { activeWalletId } = useUser();
  const { prefs } = useUserPrefs(); 
  const jobs = new Map();


  /* —— core datetime —— */
  const [date, setDate] = useState(() => {
    const d = initial.launchISO ? new Date(initial.launchISO) : new Date();
    if (!initial.launchISO) d.setMinutes(d.getMinutes() + 10);
    return d;
  });
  const [hr, setHr] = useState(() => date.getHours());
  const [min, setMin] = useState(() => date.getMinutes());
  const [nameError, setNameError] = useState("");

  /* —— meta —— */
  const [token, setToken] = useState(initial.targetToken || "");

  /* —— runtime cfg —— */
  const c0 = initial.config || {};
  const [amount, setAmount] = useState(c0.amountToSpend ?? "");
  const [maxTrades, setMaxTrades] = useState(c0.maxTrades ?? 1);
  const [priceFloor, setPriceFloor] = useState(c0.minPriceUsd ?? "");
  const [name, setName]   = useState(initial.name ?? "");
  /* —— dual buy-mode state —— */
  const [buyMode,    setBuyMode]    = useState(c0.buyMode ?? "interval");
  const [intervalSec,setIntervalSec]= useState(c0.interval ?? 30); // 🛠 FIXED
  // now stores price, amount, expiry (hrs)  ────────►
  const [limitConfigs,setLimitConfigs]=useState(
    c0.limitConfigs
      ? c0.limitConfigs.map(({ price, amount, expiresInHours }) => ({
          price: String(price ?? ""),
          amount: String(amount ?? ""),
          expiry: String(expiresInHours ?? ""),
        }))
      : [{ price: "", amount: "", expiry: "" }]
  );
    const [solUsd, setSolUsd] = useState(null);

  /* —— advanced —— */
  const [slippage, setSlippage] = useState(c0.slippage ?? 0.5);
  const [tp, setTp] = useState(c0.takeProfit ?? "");
  const [sl, setSl] = useState(c0.stopLoss ?? "");
  const [mevMode, setMevMode] = useState(c0.mevMode ?? "fast");
  const [priority, setPriority] = useState( c0.priorityFeeLamports ??
    prefs?.priorityFeeLamports ??              // 🔥 pre-fill from prefs
    "");
  /* —— UX state —— */
  const [showAdvanced, setShowAdvanced] = useState(false);


useEffect(() => {
  (async () => {
    try {
      const usd = await getSolPrice();
      if (usd) {
        window.solUsd = usd;
        setSolUsd(usd);
      }
    } catch (err) {
      console.warn("SOL price fetch failed:", err.message);
    }
  })();
}, []);


  /* —— derived —— */
const launchPreview = useMemo(() => {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}, [date]);

  /* —— helpers —— */
  const apply = (d, h, m) => setMinutes(setHours(d, h), m);

const resizeLimitArray = (n) => {
  setLimitConfigs((prev) => {
    const next = [...prev];
    while (next.length < n) next.push({ price: "", amount: "", expiry: "" });
    while (next.length > n) next.pop();
    return next;                            // ← always based on *fresh* state
  });
};

 const confirm = () => {
  // Name length validation
const trimmedName = name.trim();
if (trimmedName && (trimmedName.length < 2 || trimmedName.length > 32)) {
  setNameError("Name must be 2–32 characters");
  toast.error("Invalid strategy name: must be 2–32 characters.");
  return;
}
setNameError(""); // Clear error if valid
    const baseCfg = {
      buyMode,
      amountToSpend: num(amount),
      maxTrades:     num(maxTrades),
      slippage:      slippagePct,
      mevMode,
      ...(priceFloor !== "" && { minPriceUsd: num(priceFloor) }),
     ...(priorityLamports !== undefined && { priorityFeeLamports: priorityLamports }),
      ...(tp !== "" && { takeProfit: num(tp), tpPercent: 100 }),
      ...(sl !== "" && { stopLoss:  num(sl), slPercent: 100 }),
    };

    const modeCfg =
      buyMode === "interval"
        ? { interval: num(intervalSec) }
        : {
            limitConfigs: limitConfigs.map(({ price, amount, expiry }) => {
              const hrs = +expiry;
              return {
                price:  num(price),
                amount: num(amount),
                // clamp to 0.5–24 h  (blank ⇢ default 1h)
                expiresInHours:
                  Number.isFinite(hrs)
                    ? Math.max(0.5, Math.min(hrs, 24))
                    : 1,
              };
            }),
          };

    const built = CONFIG_BUILDERS["scheduleLauncher"]
      ? CONFIG_BUILDERS["scheduleLauncher"]({ ...baseCfg, ...modeCfg })
      : { ...baseCfg, ...modeCfg };

    /* ——— dst-safe UTC conversions ——— */
      const launchISO = toUtcIso(date);

    const payload = {
      ...(isEdit
        ? { jobId: initial.jobId }
        : { mode: "scheduleLauncher", walletId: activeWalletId }),
      name: trimmedName || null,
      config: {               // 🔥 inject prefs for any other future defaults
        ...built,
        _prefs    : prefs || {},
        outputMint: token || null,
      },
      launchISO,
      targetToken: token || null,
    };

    /* EDIT MODE ➜ PATCH only */
    if (isEdit) {
      onConfirm(payload);         // parent handles edit()
      onClose();
      return;
    }
    console.log("🚀 Schedule payload", payload);

    scheduleStrategy(payload)
      .then(({ jobId }) => {
        console.log("✅ Scheduled:", jobId);
        toast.success("📅 Strategy scheduled successfully.");
        onClose();
      })
      .catch((err) => {
        console.error("❌ Schedule error:", err);
        toast.error("Failed to schedule strategy.");
      });
    onClose();
    // Close modal immediately
  };

  /* —— shared input cls —— */
  const inp =
    "w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm " +
    "placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500";

  /* —— render —— */
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-full bg-zinc-950/95 border border-zinc-700 rounded-2xl shadow-emerald-600/10 shadow-lg backdrop-blur-md overflow-y-auto max-h-[92vh]">
        {/* header */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-white">
            <CalendarClock className="w-5 h-5 text-emerald-400" />
            Schedule Strategy
          </DialogTitle>
        </DialogHeader>
           {/* 🆕 NAME FIELD – inline beside launch preview */}
<div className="mt-2 flex items-center gap-3">
  <p className="text-sm text-emerald-300 flex-1">
    ⏰ <span className="font-semibold">{launchPreview}</span>
  </p>

  <div className="flex flex-col items-end">
    <label className="text-xs text-zinc-400 mb-1 mr-1">Name <span className="text-zinc-500">(optional)</span></label>
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Optional name…"
      maxLength={32}
      className={`${inp} max-w-[180px] text-right ${nameError ? "border-red-500 ring-1 ring-red-500" : ""}`}
    />
    {nameError && (
  <p className="text-xs text-red-400 mt-1 text-right">{nameError}</p>
)}
  </div>
</div>



        {/* —— DATE / TIME —— */}
        <div className="mt-4 grid md:grid-cols-[340px_1fr] gap-6">
          {/* calendar */}
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={date}
            onSelect={(d) => d && setDate(apply(d, hr, min))}
            className="rounded-lg bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-700 p-4"
            classNames={{
              caption: "text-zinc-200 font-medium mb-3 text-center",
              nav: "flex justify-between mb-1",
              nav_button:
                "h-7 w-7 flex items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-400 transition",
              head_row: "grid grid-cols-7 text-[10px]",
              head_cell: "uppercase text-zinc-500 tracking-wide text-center",
              row: "grid grid-cols-7 gap-1",
              day: "rounded-md py-1 text-xs md:text-sm text-zinc-300 hover:bg-zinc-700/50 transition",
              day_selected: "bg-emerald-600 text-zinc-50 font-bold shadow",
              day_today:
                "border border-dashed border-emerald-400 text-emerald-300",
            }}
            components={{
              IconLeft: () => <ChevronLeft className="h-4 w-4" />,
              IconRight: () => <ChevronRight className="h-4 w-4" />,
            }}
          />

          {/* hour / minute + core inputs */}
          <div className="flex flex-col gap-6">
            {/* time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                  Hour
                  <StrategyTooltip text="Hour the strategy should begin (24 h clock)" />
                </label>
                <select
                  value={hr}
                  onChange={(e) => {
                    const v = +e.target.value;
                    setHr(v);
                    setDate(apply(date, v, min));
                  }}
                  className={inp}
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {(h % 12 === 0 ? 12 : h % 12)} {h < 12 ? "AM" : "PM"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                  Minute
                  <StrategyTooltip text="Minute within the chosen hour the strategy starts" />
                </label>
                <select
                  value={min}
                  onChange={(e) => {
                    const v = +e.target.value;
                    setMin(v);
                    setDate(apply(date, hr, v));
                  }}
                  className={inp}
                >
                  {Array.from({ length: 60 }).map((_, m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* token & spend */}
            <div className="space-y-3">
              <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                Target Token <span className="text-zinc-500">(optional)</span>
                <StrategyTooltip text="Mint address to hard-target. Leave blank to let bot snipe discovered tokens." />
              </label>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                placeholder="Mint address…"
                className={inp}
              />

{buyMode === "interval" && (
  <>
    <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
      Total Spend (SOL)
      <StrategyTooltip name="totalSpend" />
    </label>
    <input
      value={amount}
      onChange={(e) => setAmount(e.target.value)}
      type="number"
      min="0"
      className={inp}
    />
  </>
)}
              <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                # of Buys
                <StrategyTooltip name="maxTrades" />
              </label>
              <input
                value={maxTrades}
                onChange={(e) => {
                  const v = e.target.value;
                  setMaxTrades(v);
                 // only resize when we actually have a valid positive integer
                     if (
                       buyMode === "limit" &&
                       v !== "" &&                      // skip the empty-string transition
                       Number.isFinite(+v) &&
                       +v > 0
                     ) {
                       resizeLimitArray(+v);
                     }
                }}
                type="number"
                min="1"
                className={inp}
              />

               {/* ── MIN PRICE FLOOR (USD) ── */}
                <label className="flex items-center gap-1 text-xs text-zinc-400 mb-1">
                  Min&nbsp;Price&nbsp;Floor&nbsp;(USD) <span className="text-zinc-500">(optional)</span>
                  <StrategyTooltip text="Optional: skip any buy if the live price falls BELOW this floor. Applies to BOTH modes." />
                </label>
                <input
                  value={priceFloor}
                  onChange={(e) => setPriceFloor(e.target.value)}
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="—"
                  className={inp}
                />
            </div>
          </div>
        </div>

        {/* —— BUY-MODE TOGGLE —— */}
        <div className="mt-6 flex gap-4">
          {[
            { id: "interval", label: "Interval Mode", tip: "intervalMode" },
            { id: "limit", label: "Limit Mode", tip: "limitMode" },
          ].map(({ id, label, tip }) => (
            <button
              key={id}
              onClick={() => setBuyMode(id)}
              className={`relative flex-1 py-2 rounded-lg text-sm ${
                buyMode === id
                  ? "bg-emerald-500 text-black font-bold"
                  : "bg-zinc-800 border border-zinc-700"
              }`}
            >
              {label}
              {/* tooltip icon inside button (top-right) */}
              <div className="absolute right-2 top-1">
                <StrategyTooltip name={tip} />
              </div>
            </button>
          ))}
        </div>

        {/* —— MODE PANELS —— */}
        {buyMode === "interval" ? (
          /* INTERVAL */
          <div className="mt-4 bg-black/40 p-4 rounded-lg border border-emerald-500/30">
            <label className="flex items-center gap-1 text-sm text-zinc-400">
              Interval (seconds)
              <StrategyTooltip name="intervalSeconds" />
            </label>
            <input
              type="number"
              value={intervalSec}
              onChange={(e) => setIntervalSec(e.target.value)}
              className={`${inp} mt-1`}
              min="1"
            />
            <p className="text-xs text-muted-foreground mt-1 italic">
              Will buy{" "}
              {maxTrades && amount
                ? (Number(amount) / maxTrades).toFixed(6)
                : "—"}{" "}
              SOL every {intervalSec}s
            </p>
          </div>
        ) : (
          /* LIMIT */
          <div className="mt-4 bg-black/40 p-4 rounded-lg border border-emerald-500/30 space-y-3">
            {limitConfigs.map((cfg, i) => (
              <div key={i} className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                   Limit Price #{i + 1} (USD)
                    <StrategyTooltip name="limitPrice" />
                  </label>
                  <input
                    type="number"
                    value={cfg.price}
                    onChange={(e) =>
                    setLimitConfigs(prev => {
                      const next = [...prev];
                      next[i] = { ...next[i], price: e.target.value };
                      return next;
                    })
                    }
                    className={`${inp} mt-1`}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    Amount #{i + 1} (USD)
                    <StrategyTooltip name="limitAmount" />
                  </label>
                  <input
                    type="number"
                    value={cfg.amount}
                    onChange={(e) =>
                      setLimitConfigs(prev => {
                        const next = [...prev];
                        next[i] = { ...next[i], amount: e.target.value };
                        return next;
                      })
                    }
                    className={`${inp} mt-1`}
                  />
                  <p className="text-[10px] text-zinc-500 mt-0.5 italic">
                ≈ { cfg.amount ? solUsd ? (cfg.amount / solUsd).toFixed(4) + " SOL today" : "Fetching price…" : "—" }            </p>
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    Expiry #{i + 1} (hrs)
                    <StrategyTooltip text="How long to wait for this price target before giving up. 0.5–24 h." />
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="24"
                    value={cfg.expiry}
                    onChange={(e) =>
                      setLimitConfigs(prev => {
                        const next = [...prev];
                        next[i] = { ...next[i], expiry: e.target.value };
                        return next;
                      })
                    }
                    className={`${inp} mt-1`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* —— ADVANCED (collapsible) —— */}
        <div className="mt-6">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-sm text-cyan-400 hover:text-emerald-300 transition"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                showAdvanced ? "rotate-180" : ""
              }`}
            />
            {showAdvanced ? "Hide" : "Show"} Runtime Settings
          </button>

          {showAdvanced && (
            <div className="mt-4 grid md:grid-cols-2 gap-4">
              {[
                {
                  label: "Slippage (%)",
                  state: slippage,
                  set: setSlippage,
                  tip: "slippage",
                },
                {
                  label: "Take-Profit (SOL)",
                  state: tp,
                  set: setTp,
                  tip: "takeProfit",
                  placeholder: "—",
                },
                {
                  label: "Stop-Loss (SOL)",
                  state: sl,
                  set: setSl,
                  tip: "stopLoss",
                  placeholder: "—",
                },
                {
                  label: "Priority Fee (lamports)",
                  state: priority,
                  set: setPriority,
                  tip: "priorityFee",
                },
              ].map(({ label, state, set, tip, ...rest }) => (
                <label
                  key={label}
                  className="text-xs text-zinc-400 flex flex-col gap-1"
                >
                  <span className="flex items-center gap-1">
                    {label} <StrategyTooltip name={tip} />
                  </span>
                  <input
                    value={state}
                    onChange={(e) => set(e.target.value)}
                    type="number"
                    className={inp}
                    {...rest}
                  />
                </label>
              ))}

              {/* MEV select full width */}
              <label className="md:col-span-2 text-xs text-zinc-400 flex flex-col gap-1">
                <span className="flex items-center gap-1">
                  MEV Mode <StrategyTooltip name="mevMode" />
                </span>
                <Listbox value={mevMode} onChange={setMevMode}>
                  <div className="relative">
                    <Listbox.Button className="w-full flex items-center justify-between rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                      <span className="flex items-center gap-2">
                        {mevMode === "fast" ? (
                          <Zap className="w-4 h-4 text-yellow-400" />
                        ) : (
                          <Shield className="w-4 h-4 text-red-400" />
                        )}
                        {mevMode === "fast"
                          ? "fast — fast finality"
                          : "secure — MEV protected"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-zinc-500" />
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-10 mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 shadow-lg ring-1 ring-black/5 focus:outline-none">
                      <Listbox.Option
                        value="fast"
                        className={({ active }) =>
                          `cursor-pointer px-4 py-2 text-sm text-white flex items-center gap-2 ${
                            active ? "bg-zinc-800 text-emerald-400" : ""
                          }`
                        }
                      >
                        <Zap className="w-4 h-4 text-yellow-400" />
                        fast — fast finality
                      </Listbox.Option>
                      <Listbox.Option
                        value="secure"
                        className={({ active }) =>
                          `cursor-pointer px-4 py-2 text-sm text-white flex items-center gap-2 ${
                            active ? "bg-zinc-800 text-emerald-400" : ""
                          }`
                        }
                      >
                        <Shield className="w-4 h-4 text-red-400" />
                        secure — MEV protected
                      </Listbox.Option>
                    </Listbox.Options>
                  </div>
                </Listbox>
              </label>
            </div>
          )}
        </div>

        {/* —— actions —— */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <GlowButton variant="ghost" onClick={onClose}>Cancel</GlowButton>
          <GlowButton variant="primary" onClick={confirm}>
            {isEdit ? <><Clock size={16}/> Save</>
                     : <><Clock size={16}/> Schedule</>}
          </GlowButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
