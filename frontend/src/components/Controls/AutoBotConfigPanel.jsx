/* ------------------------------------------------------------------
   AutoBotConfigPanel.jsx  – clean two‑column layout with fixed footer
-------------------------------------------------------------------*/
import React from "react";
import {
  Gauge, Timer, Hash, TrendingDown, TrendingUp, Wallet,
  Bot, Save, CalendarClock
} from "lucide-react";
import * as ToggleGroup   from "@radix-ui/react-toggle-group";
import FieldTooltip       from "./ToolTip";
import SafetyToggleRow    from "./SafetyToggleRow";
import BotControls        from "./ConfigPanel/BotControls";
import BotStatusButton    from "@/components/Controls/ConfigPanel/BotStatusButton";

/* ── fixed presets for the interval dropdown (not rendered here) ── */
export const INTERVAL_PRESETS = [
  { label: "10 sec (test)", ms:  10_000 },
  { label: "30 sec (test)", ms:  30_000 },
  { label: "5 minutes",     ms:   5 * 60_000 },
  { label: "10 minutes",    ms:  10 * 60_000 },
  { label: "15 minutes",    ms:  15 * 60_000 },
  { label: "30 minutes",    ms:  30 * 60_000 },
  { label: "60 minutes",    ms:  60 * 60_000 },
  { label: "2 hours",       ms:   2 * 60 * 60_000 },
  { label: "4 hours",       ms:   4 * 60 * 60_000 },
  { label: "8 hours",       ms:   8 * 60 * 60_000 },
  { label: "24 hours",      ms:  24 * 60 * 60_000 },
];

/* card shell */
const CARD =
  "relative p-6 pb-24 rounded-xl border border-zinc-700 " +
  "bg-zinc-900 shadow-lg hover:shadow-emerald-800/10 transition-shadow";

/* ───────────────────────── component ───────────────────────── */
export default function AutoBotConfigPanel({
  /* core props */
  config, setConfig,
  disabled, running, botLoading,
  handleStart, handleStop,
  autoRestart, setAutoRestart,
  /* schedule / countdown */
  hasSchedule, countdown,
  /* mode / multi‑mode */
  selectedMode, selectedOption,
  multiModeEnabled, railSelection,
  /* multi‑configs (unused here but needed by helper) */
  multiConfigs,
  /* helpers / validators */
  onSafetyChange,
  AMOUNT_DISABLED_MODES,
  TPSL_DISABLED_MODES,
  selectedWalletBalance,
  errors,
  handleChange,
  handleTpSlChange,
  blockNegatives,
  requiresExtraConfig,
  isExtraConfigEmpty,
  requiredFieldStatus,
  getMissingFields,
  /* controls modal helpers */
  schedules         = [],
  setIsSavedConfigModalOpen,
  setIsScheduleManagerOpen,
}) {
  /* ── header ── */
  const Header = (
    <div className="flex items-start justify-between mb-6">
      {/* left = title */}
      <h2 className="text-xl font-bold leading-tight">
        {multiModeEnabled
          ? "🧠 Multi‑Strategy Mode"
          : `${selectedOption?.label} Auto‑Bot Configuration`}
      </h2>

      {/* right = Running/Saved/Schedules controls */}
      <ToggleGroup.Root
        type="single"
        className="flex border border-zinc-700 rounded-md overflow-hidden bg-zinc-800 text-xs font-semibold"
      >
        {/* running bots */}
        <BotStatusButton
          trigger={
            <div className="px-4 py-2 h-full flex items-center gap-2 bg-emerald-600/40 hover:bg-zinc-700">
              <Bot size={16}/> Running Bots
            </div>
          }
        />

        {/* saved configs */}
        <button
          onClick={() => setIsSavedConfigModalOpen?.(true)}
          className="px-4 py-2 h-full flex items-center gap-2 hover:bg-zinc-700"
        >
          <Save size={14}/> Saved
        </button>

        {/* schedules */}
        <button
          onClick={() => setIsScheduleManagerOpen?.(true)}
          className="relative px-4 py-2 h-full flex items-center gap-2 hover:bg-zinc-700"
        >
          <CalendarClock size={14}/> Schedules
          {schedules.length > 0 && (
            <span className="absolute -right-2 -top-2 bg-orange-600 rounded-full text-xxs px-1.5">
              {schedules.length}
            </span>
          )}
        </button>
      </ToggleGroup.Root>
    </div>
  );

  /* ── render ── */
  return (
    <div className={CARD}>
      {Header}

      {/* ── INPUT GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ───────── 🧮 BASE SETTINGS ───────── */}
        <InputField label="Slippage (%)"     name="slippage"      placeholder="0.5"  icon={<Gauge size={16}/>}/>
        <InputField label="Scan Every (sec)" name="interval"      placeholder="3"    icon={<Timer size={16}/>}/>
        <InputField label="Max Trades"       name="maxTrades"     placeholder="5"    icon={<Hash size={16}/>}/>
        <InputField label="Amount (SOL)"     name="amountToSpend" placeholder="0.05" icon={<Wallet size={16}/> }/>

        {/* ───────── 🛡 RISK + STRATEGY ───────── */}
        <InputField label="Stop Loss (%)"    name="stopLoss"   placeholder="-3" icon={<TrendingDown size={16}/>}/>
        <InputField label="Take Profit (%)"  name="takeProfit" placeholder="5"  icon={<TrendingUp   size={16}/>}/>

        {/* safety toggle */}
        <div className="md:col-span-2 flex flex-col gap-1 text-sm font-medium">
           <SafetyToggleRow cfg={config} onChange={onSafetyChange}/>
        </div>

        {/* strategy‑specific button */}
        <StrategyConfigButton/>
      </div>

      {/* ── BOT CONTROLS ── */}
      <div className="absolute bottom-6 right-6">
        <BotControls
          disabled={disabled}
          missing={getMissingFields()}
          running={running}
          onStart={handleStart}
          onStop={handleStop}
          autoRestart={autoRestart}
          setAutoRestart={setAutoRestart}
          currentMode={selectedMode}
          botLoading={botLoading}
          hasSchedule={hasSchedule}
          countdown={countdown}
        />
      </div>

      {/* ── SUMMARY FOOTER ── */}
      <div className="absolute bottom-6 left-6 text-xs leading-snug">
        {errors && errors.length > 0 && (
          <p className="text-red-400">
            ⚠️ {errors.length} validation {errors.length === 1 ? "error" : "errors"}.
          </p>
        )}
        {running && (
          <p className="text-emerald-400">
            Bot is live {countdown && `(next tick in ${countdown}s)`}.
          </p>
        )}
        {!running && !errors?.length && (
          <p className="text-zinc-400">Ready to launch.</p>
        )}
      </div>
    </div>
  );

  /* ───────────────── helper components ───────────────── */

  function InputField({ label, name, placeholder, icon }) {
    const value       = config?.[name] ?? "";
    const isTPSLField = ["stopLoss", "takeProfit"].includes(name);
    const isDisabled  =
      disabled ||
      (isTPSLField && TPSL_DISABLED_MODES.includes(selectedMode)) ||
      (name === "amountToSpend" && AMOUNT_DISABLED_MODES.includes(selectedMode));

    return (
      <label className="flex flex-col gap-1 text-sm font-medium">
        <div className="flex items-center gap-1">
          {label}
          <FieldTooltip name={name}/>
        </div>

        <div className="relative">
          {icon && <span className="absolute left-2 top-2.5 text-zinc-400">{icon}</span>}
          <input
            type="number"
            step={name === "amountToSpend" ? "0.001" : "1"}
            name={name}
            placeholder={placeholder}
            value={value}
            onChange={(e) =>
              isTPSLField
                ? handleTpSlChange(e)
                : blockNegatives(e, handleChange)
            }
            disabled={isDisabled}
            className={`pl-7 pr-3 py-2 w-full rounded-md border text-right
                        bg-zinc-800 border-zinc-600 placeholder:text-zinc-400
                        shadow-inner transition
                        ${isDisabled ? "opacity-40 cursor-not-allowed"
                                      : "hover:border-emerald-500 focus:outline-none focus:border-emerald-500"}`}
          />
        </div>
      </label>
    );
  }

  function StrategyConfigButton() {
    const needsExtra =
      requiresExtraConfig(selectedMode) && isExtraConfigEmpty;

    return (
      <div className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
        <span>
          Strategy Config{" "}
          <span className="italic text-zinc-400">(required)</span>
        </span>

        <button
          type="button"
          className="px-4 py-2 w-full md:w-auto rounded-md border border-zinc-700 bg-zinc-800 hover:border-emerald-500"
          onClick={() =>
            multiModeEnabled
              ? window.dispatchEvent(new Event("openMultiStrategyConfig"))
              : window.dispatchEvent(new Event("openStrategyConfig"))
          }
        >
          {multiModeEnabled
            ? "🧠 Configure Strategies"
            : `${selectedOption?.label || railSelection} Settings`}
        </button>

        {needsExtra && (
          <p className="text-xs text-red-400 italic">
            ⚠️ Fill out strategy settings before launching.
          </p>
        )}
        <p className="text-xs text-zinc-400">{requiredFieldStatus}</p>
      </div>
    );
  }
}
