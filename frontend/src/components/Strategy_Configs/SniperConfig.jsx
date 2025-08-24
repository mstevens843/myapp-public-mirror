
// src/components/strategies/SniperConfig.jsx
// SniperConfig.jsx — tabs hoisted to module scope to prevent input remount/focus loss
import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import StrategyTooltip from "./StrategyTooltip";
import TokenSourceSelector, { feedOptions as FEEDS } from "./TokenSourceSelector";
import AdvancedFields from "../ui/AdvancedFields";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { saveConfig } from "@/utils/autobotApi";

// Logging helpers for input instrumentation
import {
  logChange,
  logBlur,
  logEffect,
  logFocus,
  logSelection,
  logRender,
} from "@/dev/inputDebug";

/* fields required by validator ---------------------------------------- */
export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "minMarketCap",
  "maxMarketCap",
  "tokenFeed",
  "monitoredTokens",
  "overrideMonitored",
  "delayBeforeBuyMs",
  "priorityFeeLamports",
  "mevMode",
  "briberyAmount",
  // Exit Strategy (new)
  "smartExitMode",
  "intervalSec",
  "authorityFlipExit",
  "lpOutflowExitPct",
  "rugDelayBlocks",
  "timeMaxHoldSec",
  "timeMinPnLBeforeTimeExitPct",
  "tpPercent",
  "slPercent",
];

export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

// numeric fields we edit as raw strings (no coercion until blur/save)
const NUM_FIELDS = [
  "entryThreshold",
  "volumeThreshold",
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "minMarketCap",
  "maxMarketCap",
  "delayBeforeBuyMs",
  "priorityFeeLamports",
  "briberyAmount",
  // Exit Strategy (new)
  "intervalSec",
  "lpOutflowExitPct",
  "rugDelayBlocks",
  "timeMaxHoldSec",
  "timeMinPnLBeforeTimeExitPct",
  "tpPercent",
  "slPercent",
];

/* ---------- UI helpers (module scope; stable identities) ---------- */
const FIELD_WRAP =
  "relative rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 hover:border-zinc-600 focus-within:border-emerald-500/70 transition";
const INP =
  "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 outline-none border-none focus:outline-none";

const PRICE_WINS = ["1m", "5m", "30m", "1h", "2h", "4h", "6h"];
const VOLUME_WINS = ["1m", "5m", "30m", "1h", "4h", "8h", "24h"];

const Card = ({ title, right, children, className = "" }) => (
  <div
    className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 sm:p-4 ${className}`}
  >
    {(title || right) && (
      <div className="flex items-center justify-between mb-3">
        {title ? (
          <div className="text-sm font-semibold text-zinc-200">{title}</div>
        ) : (
          <div />
        )}
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

const TAB_KEYS = {
  core: [
    "entryThreshold",
    "priceWindow",
    "volumeThreshold",
    "volumeWindow",
  ],
  execution: ["delayBeforeBuyMs", "priorityFeeLamports", "mevMode", "briberyAmount"],
  tokens: ["tokenFeed", "monitoredTokens", "overrideMonitored"],
  advanced: [],
  // Exit Strategy (new)
  exit: [
    "smartExitMode",
    "intervalSec",
    "authorityFlipExit",
    "lpOutflowExitPct",
    "rugDelayBlocks",
    "timeMaxHoldSec",
    "timeMinPnLBeforeTimeExitPct",
    "tpPercent",
    "slPercent",
  ],
};

const RequiredOnlyPlaceholder = () => (
  <div className="text-sm text-zinc-400 italic p-2">
    Hidden in Required-Only Mode. Toggle <span className="text-emerald-400 font-semibold">Required only</span> off to access these settings.
  </div>
);

const validateSniperConfig = (cfg = {}) => {
  const errs = [];
  if (
    cfg.entryThreshold === "" ||
    cfg.entryThreshold === undefined ||
    Number.isNaN(+cfg.entryThreshold)
  ) {
    errs.push("entryThreshold is required.");
  }
  if (
    cfg.volumeThreshold === "" ||
    cfg.volumeThreshold === undefined ||
    Number.isNaN(+cfg.volumeThreshold)
  ) {
    errs.push("volumeThreshold is required.");
  }
  return errs;
};

const countErrorsForTab = (errors) => {
  const lower = errors.map((e) => String(e).toLowerCase());
  const counts = { core: 0, execution: 0, tokens: 0, advanced: 0, exit: 0 };
  for (const tab of Object.keys(TAB_KEYS)) {
    const keys = TAB_KEYS[tab];
    counts[tab] = lower.filter((msg) =>
      keys.some((k) => msg.includes(k.toLowerCase()))
    ).length;
  }
  const categorized = Object.values(counts).reduce((a, b) => a + b, 0);
  if (categorized < errors.length) counts.core += errors.length - categorized;
  return counts;
};

/* ---------- Tab components hoisted to module scope ---------- */
const CoreTab = React.memo(function CoreTab({
  view,
  disabled,
  handleChange,
  handleBlur,
}) {
  return (
    <Section>
      <Card title="Core Filters" className="sm:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Pump threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Threshold (%)</span>
              <StrategyTooltip name="entryThreshold" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="entryThreshold"
                value={view.entryThreshold ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("entryThreshold")}
                placeholder="e.g. 3"
                className={INP}
                disabled={disabled}
              />
            </div>
          </div>

          {/* Pump window (optional; hidden in Required-only) */}
          {!view?.__showRequiredOnly && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Pump Time Window</span>
                <StrategyTooltip name="priceWindow" />
              </div>
              <div className={FIELD_WRAP}>
                <select
                  name="priceWindow"
                  value={view.priceWindow}
                  onChange={handleChange}
                  className={`${INP} appearance-none pr-8`}
                  disabled={disabled}
                >
                  <option value="">None</option>
                  {PRICE_WINS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Volume floor */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Floor (USD)</span>
              <StrategyTooltip name="volumeThreshold" />
            </div>
            <div className={FIELD_WRAP}>
              <input
                type="text"
                inputMode="decimal"
                name="volumeThreshold"
                value={view.volumeThreshold ?? ""}
                onChange={handleChange}
                onBlur={handleBlur("volumeThreshold")}
                disabled={disabled}
                placeholder="e.g. 50000"
                className={INP}
              />
            </div>
          </div>

          {/* Volume window (optional; hidden in Required-only) */}
          {!view?.__showRequiredOnly && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Volume Time Window</span>
                <StrategyTooltip name="volumeWindow" />
              </div>
              <div className={FIELD_WRAP}>
                <select
                  name="volumeWindow"
                  value={view.volumeWindow}
                  onChange={handleChange}
                  disabled={disabled}
                  className={`${INP} appearance-none pr-8`}
                >
                  <option value="">None</option>
                  {VOLUME_WINS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
});

const ExecutionTab = React.memo(function ExecutionTab({
  view,
  disabled,
  handleChange,
  handleBlur,
  requiredOnly,
}) {
  return (
    <Section>
      <Card title="Timing & Fees">
        {requiredOnly ? (
          <RequiredOnlyPlaceholder />
        ) : (
          <div className="grid gap-4">
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
                  disabled={disabled}
                  placeholder="e.g. 20000"
                  className={INP}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Delay Before Buy (ms)</span>
                <StrategyTooltip name="delayBeforeBuyMs" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="delayBeforeBuyMs"
                  value={view.delayBeforeBuyMs ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("delayBeforeBuyMs")}
                  disabled={disabled}
                  placeholder="e.g. 5000"
                  className={INP}
                />
              </div>
            </div>
          </div>
        )}
      </Card>
      <Card title="MEV Preferences">
        {requiredOnly ? (
          <RequiredOnlyPlaceholder />
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>MEV Mode</span>
                <StrategyTooltip name="mevMode" />
              </div>
              <div className={FIELD_WRAP}>
                <select
                  name="mevMode"
                  value={view.mevMode}
                  onChange={handleChange}
                  disabled={disabled}
                  className={`${INP} appearance-none pr-8`}
                >
                  <option value="fast">fast</option>
                  <option value="secure">secure</option>
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Bribery (SOL)</span>
                <StrategyTooltip name="briberyAmount" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="briberyAmount"
                  value={view.briberyAmount ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("briberyAmount")}
                  disabled={disabled}
                  placeholder="e.g. 0.002"
                  className={INP}
                />
              </div>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
});

const TokensTab = React.memo(function TokensTab({ view, setConfig, disabled }) {
  return (
    <Section>
      <Card title="Token List" className="sm:col-span-2">
        {/* Pass through parent setConfig so selector can write immediately */}
        <TokenSourceSelector config={view} setConfig={setConfig} disabled={disabled} />
      </Card>
    </Section>
  );
});

const ExitStrategyTab = React.memo(function ExitStrategyTab({
  view,
  disabled,
  handleChange,
  handleBlur,
  requiredOnly,
}) {
  return (
    <Section>

      <Card title="Smart Exit">
        {requiredOnly ? (
          <RequiredOnlyPlaceholder />
        ) : (
          <div className="grid gap-4">
            {/* Mode */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Smart Exit Mode</span>
                <StrategyTooltip name="smartExitMode" />
              </div>
              <div className={FIELD_WRAP}>
                <select
                  name="smartExitMode"
                  value={view.smartExitMode ?? "off"}
                  onChange={handleChange}
                  disabled={disabled}
                  className={`${INP} appearance-none pr-8`}
                >
                  <option value="off">off</option>
                  <option value="time">time</option>
                  <option value="liquidity">liquidity</option>
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>

            {/* Interval (sec) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Check Interval (sec)</span>
                <StrategyTooltip name="intervalSec" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="intervalSec"
                  value={view.intervalSec ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("intervalSec")}
                  disabled={disabled}
                  placeholder="e.g. 5"
                  className={INP}
                />
              </div>
            </div>

            {/* Authority Flip Exit */}
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <input
                type="checkbox"
                name="authorityFlipExit"
                checked={!!view.authorityFlipExit}
                onChange={handleChange}
                disabled={disabled}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
              />
              Authority-Flip Exit
              <StrategyTooltip name="authorityFlipExit" />
            </label>

            {/* LP Outflow Exit (%) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>LP Outflow Exit (%)</span>
                <StrategyTooltip name="lpOutflowExitPct" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="lpOutflowExitPct"
                  value={view.lpOutflowExitPct ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("lpOutflowExitPct")}
                  disabled={disabled}
                  placeholder="e.g. 50"
                  className={INP}
                />
              </div>
            </div>

            {/* Rug Delay (blocks) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Rug Delay (blocks)</span>
                <StrategyTooltip name="rugDelayBlocks" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="rugDelayBlocks"
                  value={view.rugDelayBlocks ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("rugDelayBlocks")}
                  disabled={disabled}
                  placeholder="e.g. 0"
                  className={INP}
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Time Mode Settings */}
      <Card title="Time Exit Settings">
        {requiredOnly ? (
          <RequiredOnlyPlaceholder />
        ) : (
          <div className="grid gap-4">
            {/* Max Hold (sec) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Max Hold (sec)</span>
                <StrategyTooltip name="timeMaxHoldSec" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="timeMaxHoldSec"
                  value={view.timeMaxHoldSec ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("timeMaxHoldSec")}
                  disabled={disabled}
                  placeholder="e.g. 120"
                  className={INP}
                />
              </div>
            </div>

            {/* Min PnL before time-exit (%) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>Min PnL before time-exit (%)</span>
                <StrategyTooltip name="timeMinPnLBeforeTimeExitPct" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="timeMinPnLBeforeTimeExitPct"
                  value={view.timeMinPnLBeforeTimeExitPct ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("timeMinPnLBeforeTimeExitPct")}
                  disabled={disabled}
                  placeholder="e.g. 0"
                  className={INP}
                />
              </div>
            </div>
          </div>
        )}
      </Card>

                  {/* TP/SL Sell Amounts */}
      <Card title="TP / SL Sell Amounts">
        {requiredOnly ? (
          <RequiredOnlyPlaceholder />
        ) : (
          <div className="grid gap-4">
            {/* TP Sell Amount (%) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>TP Sell Amount (%)</span>
                <StrategyTooltip name="tpPercent" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="tpPercent"
                  value={view.tpPercent ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("tpPercent")}
                  disabled={disabled}
                  placeholder="e.g. 100"
                  className={INP}
                />
              </div>
            </div>

            {/* SL Sell Amount (%) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                <span>SL Sell Amount (%)</span>
                <StrategyTooltip name="slPercent" />
              </div>
              <div className={FIELD_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  name="slPercent"
                  value={view.slPercent ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur("slPercent")}
                  disabled={disabled}
                  placeholder="e.g. 100"
                  className={INP}
                />
              </div>
            </div>
          </div>
        )}
      </Card>


    </Section>
  );
});

const AdvancedTab = React.memo(function AdvancedTab({
  view,
  setConfig,
  disabled,
  children,
  requiredOnly,
}) {
  return (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          {requiredOnly ? (
            <RequiredOnlyPlaceholder />
          ) : (
            <AdvancedFields config={view} setConfig={setConfig} disabled={disabled} strategy="sniper" />
          )}
        </Card>
      </Section>
      {children}
    </>
  );
});

/* ---------- Main component ---------- */
const SniperConfig = ({
  config = {},
  setConfig,
  disabled,
  children,
  mode = "sniper",
}) => {
  const defaults = {
    // Core
    entryThreshold: 3,
    volumeThreshold: 50_000,
    priceWindow: "1h",
    volumeWindow: "24h",
    tokenFeed: "new",
    monitoredTokens: "",
    overrideMonitored: false,
    minMarketCap: "",
    maxMarketCap: "",
    minTokenAgeMinutes: "",
    maxTokenAgeMinutes: "",
    // Execution
    delayBeforeBuyMs: "",
    priorityFeeLamports: "",
    mevMode: "fast",
    briberyAmount: 0.002,
    // Advanced (passed-through to AdvancedFields)
    tpLadder: "",
    trailingStopPct: "",
    // Exit Strategy (new)
    smartExitMode: "off",
    intervalSec: 5,
    authorityFlipExit: false,
    lpOutflowExitPct: 50,
    rugDelayBlocks: 0,
    timeMaxHoldSec: "",
    timeMinPnLBeforeTimeExitPct: "",
    tpPercent: "",
    slPercent: "",
  };

  // Merge defaults with incoming config
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  // Determine debug flags from localStorage. Always guarded under typeof window
  const isDebug =
    typeof window !== "undefined" &&
    (localStorage.BREAKOUT_DEBUG === "1" || localStorage.SNIPER_DEBUG === "1");
  const isRawInputMode =
    typeof window !== "undefined" &&
    (localStorage.BREAKOUT_RAW_INPUT_MODE === "1" ||
      localStorage.SNIPER_RAW_INPUT_MODE === "1");

  // Track the active field for guard rails. Use a ref so updates don't cause rerender.
  const activeFieldRef = useRef(null);
  const clearActiveField = useCallback(() => {
    activeFieldRef.current = null;
    if (typeof window !== "undefined") {
      // Maintain compatibility with parent guard that reads __BREAKOUT_ACTIVE_FIELD
      window.__BREAKOUT_ACTIVE_FIELD = null;
      window.__SNIPER_ACTIVE_FIELD = null;
    }
  }, []);

  // Event handlers to capture focus and selection across the component.
  const handleFocusCapture = useCallback(
    (e) => {
      const name = e?.target?.name;
      if (!name) return;
      activeFieldRef.current = name;
      if (typeof window !== "undefined") {
        // Maintain compatibility with parent guard that reads __BREAKOUT_ACTIVE_FIELD
        window.__BREAKOUT_ACTIVE_FIELD = name;
        window.__SNIPER_ACTIVE_FIELD = name;
      }
      logFocus({ comp: "SniperConfig", field: name });
    },
    []
  );

  const handleBlurCapture = useCallback(
    (e) => {
      const name = e?.target?.name;
      // Only clear if leaving the current active field
      if (!name) return;
      if (activeFieldRef.current === name) {
        clearActiveField();
      }
    },
    [clearActiveField]
  );

  const handleSelectCapture = useCallback((e) => {
    const name = e?.target?.name;
    if (!name) return;
    const { selectionStart: start, selectionEnd: end } = e.target;
    logSelection({ comp: "SniperConfig", field: name, start, end });
  }, []);

  // Log renders with a snapshot of the current field set for debugging.
  useEffect(() => {
    logRender({
      comp: "SniperConfig",
      fieldSet: Object.keys(merged),
      reason: "render",
    });
  }, [merged]);

  // Handler for all onChange events. Writes raw values into parent config
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
      setConfig((prevConfig) => {
        const updated = { ...(prevConfig ?? {}) };
        updated[name] = next;
        return updated;
      });
      logChange({
        comp: "SniperConfig",
        field: name,
        raw: value,
        prev: prevVal,
        next,
      });
    },
    [setConfig, merged]
  );

  // Per-field blur handler for numeric fields. Converts the raw string into a number if possible.
  const handleBlur = useCallback(
    (field) => (e) => {
      if (!NUM_FIELDS.includes(field)) {
        // Non-numeric field: still clear active on blur
        clearActiveField();
        return;
      }
      const raw = e?.currentTarget?.value ?? "";
      const before = merged[field];
      if (isRawInputMode) {
        // Skip coercion; leave as raw string
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
      setConfig((prevConfig) => {
        const updated = { ...(prevConfig ?? {}) };
        updated[field] = after;
        return updated;
      });
      logBlur({ comp: "SniperConfig", field, before, after });
      // Clear active field after processing
      clearActiveField();
    },
    [setConfig, merged, isRawInputMode, clearActiveField]
  );

  // Build a view model that ensures numeric values are always represented as strings for display
  const view = useMemo(() => {
    const v = { ...merged };
    NUM_FIELDS.forEach((k) => {
      const val = merged[k];
      if (val === "" || val === null || val === undefined) {
        v[k] = "";
      } else {
        v[k] = String(val);
      }
    });
    return v;
  }, [merged]);

  const errors = validateSniperConfig(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);
  // Preset dialog state
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
      logEffect({
        comp: "SniperConfig",
        reason: "savePreset",
        touched: patch,
      });
      await saveConfig(mode, { ...merged, ...patch }, name);
      window.dispatchEvent(
        new CustomEvent("savedConfig:changed", { detail: { mode } })
      );
      toast.success(name ? `Saved preset “${name}”` : "Preset saved");
      setShowSaveDialog(false);
      setPresetName("");
    } catch (e) {
      toast.error(e?.message || "Failed to save preset");
    }
  };

  // Flag for parent modal to suppress close while the save dialog is open
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

  // expose showRequiredOnly to CoreTab via view (read-only) so it can hide optional fields
  const viewForTabs = useMemo(
    () => ({ ...view, __showRequiredOnly: showRequiredOnly }),
    [view, showRequiredOnly]
  );

  const summaryTokenList = view.overrideMonitored
    ? " My Token List"
    : FEEDS.find((f) => f.value === view.tokenFeed)?.label || "Custom";

  return (
    <div
      className="bg-zinc-950/90 text-zinc-200 rounded-xl border border-zinc-800 shadow-xl focus:outline-none"
      // Capture focus/blur/select events to track the active field for guard rails
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onSelectCapture={handleSelectCapture}
    >
      {/* Header + Tabs */}
      <div className="p-4 sm:p-5 border-b border-zinc-900 sticky top-0 z-[5] bg-zinc-1000 focus:outline-none">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
            Sniper Config
            {typeof window !== "undefined" && isDebug && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-white">
                Input Debug ON
              </span>
            )}
            {typeof window !== "undefined" && isRawInputMode && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-700 text-white">
                RAW INPUT MODE
              </span>
            )}
          </h2>
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
            <span className="text-xs sm:text-sm text-zinc-300">
              Required only
            </span>
          </label>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 relative">
          <TabButton
            active={activeTab === "core"}
            onClick={() => setActiveTab("core")}
            badge={tabErr.core}
          >
            Core
          </TabButton>
          <TabButton
            active={activeTab === "execution"}
            onClick={() => setActiveTab("execution")}
            badge={tabErr.execution}
          >
            Execution
          </TabButton>
          <TabButton
            active={activeTab === "tokens"}
            onClick={() => setActiveTab("tokens")}
            badge={tabErr.tokens}
          >
            Token List
          </TabButton>
          <TabButton
            active={activeTab === "advanced"}
            onClick={() => setActiveTab("advanced")}
            badge={tabErr.advanced}
          >
            Advanced
          </TabButton>
          <TabButton
            active={activeTab === "exit"}
            onClick={() => setActiveTab("exit")}
            badge={tabErr.exit}
          >
            Exit Strategy
          </TabButton>
        </div>
      </div>
      {/* Content */}
      <div className="p-4 sm:p-5" data-inside-dialog="1">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded-md p-2 mb-4">
          Quick-reaction sniper that enters on sharp pumps within your chosen
          windows and constraints.
        </div>
        {errors.length > 0 && (
          <div className="bg-red-900 text-red-100 text-xs p-2 rounded-md mb-4 border border-red-800 space-y-1">
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}
        {activeTab === "core" && (
          <CoreTab
            view={viewForTabs}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
          />
        )}
        {activeTab === "execution" && (
          <ExecutionTab
            view={view}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
            requiredOnly={showRequiredOnly}
          />
        )}
        {activeTab === "tokens" && (
          <TokensTab view={view} setConfig={setConfig} disabled={disabled} />
        )}
        {activeTab === "advanced" && (
          <AdvancedTab view={view} setConfig={setConfig} disabled={disabled} requiredOnly={showRequiredOnly}>
            {typeof children !== "undefined" ? children : null}
          </AdvancedTab>
        )}
        {activeTab === "exit" && (
          <ExitStrategyTab
            view={view}
            disabled={disabled}
            handleChange={handleChange}
            handleBlur={handleBlur}
            requiredOnly={showRequiredOnly}
          />
        )}
        {/* Strategy Summary */}
        <div className="mt-6 bg-zinc-900 rounded-md p-3">
          <p className="text-xs text-right leading-4">
            <span className="text-pink-400 font-semibold">Sniper Summary</span>
            &nbsp;— List:&nbsp;
            <span className="text-emerald-300 font-semibold">
              {summaryTokenList}
            </span>
            ;&nbsp;Pump&nbsp;
            <span className="text-emerald-300 font-semibold">
              ≥ {view.entryThreshold}%
            </span>
            &nbsp;in&nbsp;
            <span className="text-indigo-300 font-semibold">
              {view.priceWindow || "1h"}
            </span>
            ;&nbsp;Volume&nbsp;
            <span className="text-emerald-300 font-semibold">
              ≥ ${(+view.volumeThreshold || 0).toLocaleString()}
            </span>
            &nbsp;in&nbsp;
            <span className="text-indigo-300 font-semibold">
              {view.volumeWindow || "24h"}
            </span>
            {(view.minTokenAgeMinutes || view.maxTokenAgeMinutes) && (
              <>
                ; Age{" "}
                {view.minTokenAgeMinutes && (
                  <span className="text-rose-300 font-semibold">
                    ≥ {view.minTokenAgeMinutes}m
                  </span>
                )}
                {view.minTokenAgeMinutes && view.maxTokenAgeMinutes && " / "}
                {view.maxTokenAgeMinutes && (
                  <span className="text-rose-300 font-semibold">
                    ≤ {view.maxTokenAgeMinutes}m
                  </span>
                )}
              </>
            )}
            {(view.minMarketCap || view.maxMarketCap) && (
              <>
                ; MC{" "}
                {view.minMarketCap && (
                  <span className="text-orange-300 font-semibold">
                    ≥ ${(+view.minMarketCap || 0).toLocaleString()}
                  </span>
                )}
                {view.minMarketCap && view.maxMarketCap && " / "}
                {view.maxMarketCap && (
                  <span className="text-orange-300 font-semibold">
                    ≤ ${(+view.maxMarketCap || 0).toLocaleString()}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      </div>
      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t border-zinc-900 p-3 sm:p-4 bg-zinc-1000 rounded-b-2xl" data-inside-dialog="1">
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
              onClick={() => {
                const reset = { ...defaults };
                setConfig((prev) => ({ ...(prev ?? {}), ...reset }));
                logEffect({
                  comp: "SniperConfig",
                  reason: "reset",
                  touched: reset,
                });
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
              <Dialog.Title className="text-sm font-semibold text-white text-center">
                Save Config Preset
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute top-2 right-2 p-1 rounded-md
                             text-zinc-400 hover:text-white hover:bg-zinc-800"
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

export default SniperConfig;
