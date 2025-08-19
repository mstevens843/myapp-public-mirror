// SettingsPanel.jsx
import React, { useState, useEffect } from "react";
import * as Switch from "@radix-ui/react-switch";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useUserPrefs } from "@/contexts/UserPrefsContext";
// import { getPrefs, savePrefs } from "@/utils/api"; // ← no longer needed

import {
  Info,
  Settings,
  Check,
  DollarSign,
  Percent,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";

/* ───────────────────────────────── CONFIG ────────────────────────────── */
const defaults = {
  confirmManual:         true,
  confirmBotStart:       true,
  confirmBeforeTrade:    true,
  alertsEnabled:         true,
  autoBuy:               { enabled: false, amount: 0.05 },
  slippage:              1.0,
  defaultMaxSlippage:    3.0,
  defaultPriorityFee:    1_000,      // μLAM
  mevMode:               "fast",     // fast | secure
  briberyAmount:         0.002,      // SOL (UI units)
};

/* ────────────────────────────── Helpers ──────────────────────────────── */
const GlowButton = ({ children, onClick, show, className = "" }) => {
  if (!show) return null;
  return (
    <button
      onClick={onClick}
      className={
        `absolute right-2 top-1/2 -translate-y-1/2
         bg-emerald-600 hover:bg-emerald-500 transition-colors
         p-[3px] rounded ${className}`
      }
    >
      {children}
    </button>
  );
};

/* ────────────────────────────── Tooltip ──────────────────────────────── */
function SettingsTooltip({ name, text }) {
  const lookup = {
    /* toggles */
    confirmBeforeTrade: "Pop up a confirmation before every manual BUY / SELL.",
    alertsEnabled:
      "Send Telegram alerts for trades, errors & watchdog events. Turn off if you hate pings.",
    "autoBuy.enabled":
      "If ON, bot will instantly buy any token that passes your filters without asking.",
    /* numeric */
    autoBuyAmount:
      "Typical: 0.05 – 0.2 SOL for test snipes.\nLeave 0 to disable when Auto-Buy is off.",
    defaultSlippage:
      "Default % slippage to send to Jupiter.\n1 % is safe; veterans use 0.5 % on majors.",
    defaultMaxSlippage:
      "Hard ceiling: quotes above this (%) are refused.\n3 – 5 % is common anti-rug limit.",
    defaultPriorityFee:
      "Extra μLAM paid for compute priority.\n Boost compute unit priority on the Solana network.\n Normal traffic: 1 000 – 5 000.\nHeavy congestion: 10 000 +.",
    validatorBribe:
      "Direct validator tip (MEV-style bribe).\nUI is in SOL.",
    /* MEV */
    mevMode: `"Fast" = normal route (fast UX, no shielding).\n"Secure" = enables MEV protection: shared accounts, adaptive compute, bribes, and shielding.\nJupiter uses private routes to prevent frontrunning.`,
  };

  const content = text || lookup[name] || "No help yet, ping dev.";

  return (
    <div className="relative group flex items-center">
      <Info
        size={14}
        className="text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div
        className="absolute left-5 top-[-4px] z-20 hidden group-hover:block
                    bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600
                    max-w-[240px] w-max shadow-lg whitespace-pre-line break-words"
      >
        {content}
      </div>
    </div>
  );
}

/* ───────────────────────────── Component ─────────────────────────────── */
export default function SettingsPanel() {
  const { prefs, updatePrefs } = useUserPrefs();

  const [draftAuto,        setDraftAuto]        = useState("");
  const [draftSlip,        setDraftSlip]        = useState("");
  const [draftDefaultSlip, setDraftDefaultSlip] = useState("");
  const [draftPriorityFee, setDraftPriorityFee] = useState("");
  const [draftBribe,       setDraftBribe]       = useState("");

  // ⚠️ No bootstrap here — Context handles it.

  /* hydrate draft inputs whenever prefs change */
  useEffect(() => {
    if (!prefs) return;
    setDraftAuto(String(prefs.autoBuy.amount ?? defaults.autoBuy.amount));
    setDraftSlip(String(prefs.slippage ?? defaults.slippage));
    setDraftDefaultSlip(String(prefs.defaultMaxSlippage ?? defaults.defaultMaxSlippage));
    setDraftPriorityFee(String(prefs.defaultPriorityFee ?? defaults.defaultPriorityFee));
    setDraftBribe(String(prefs.briberyAmount ?? defaults.briberyAmount));
  }, [prefs]);

  /* persist helper — rely on context’s server/local save */
  const persist = (next) => updatePrefs(next);

  if (!prefs) return null; // still loading

  /* path setter for nested toggle */
  const applyPath = (state, path, value) => {
    const [root, sub] = path.split(".");
    return sub
      ? { ...state, [root]: { ...state[root], [sub]: value } }
      : { ...state, [root]: value };
  };

  /* dirty flags */
  const parsedAuto     = parseFloat(draftAuto)        || 0;
  const parsedSlip     = parseFloat(draftSlip)        || 0;
  const parsedMaxSlip  = parseFloat(draftDefaultSlip) || 0;
  const parsedPriority = parseInt(draftPriorityFee)   || 0;
  const parsedBribe    = parseFloat(draftBribe)       || 0;

  const autoChanged    = parsedAuto     !== (prefs.autoBuy?.amount ?? 0);
  const slipChanged    = parsedSlip     !== (prefs.slippage ?? 0);
  const maxSlipChanged = parsedMaxSlip  !== (prefs.defaultMaxSlippage ?? 0);
  const prioChanged    = parsedPriority !== (prefs.defaultPriorityFee ?? 0);
  const bribeChanged   = parsedBribe    !== (prefs.briberyAmount ?? 0);

  /* save handlers */
  const saveAuto     = () => persist({ ...prefs, autoBuy: { ...prefs.autoBuy, amount: parsedAuto } });
  const saveSlip     = () => persist({ ...prefs, slippage: parsedSlip });
  const saveMaxSlip  = () => persist({ ...prefs, defaultMaxSlippage: parsedMaxSlip });
  const savePriority = () => persist({ ...prefs, defaultPriorityFee: parsedPriority });
  const saveBribe    = () => persist({ ...prefs, briberyAmount: parsedBribe });

  /* ──────────────────────────── RENDER ─────────────────────────────── */
  return (
    <motion.section
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="container mx-auto p-6 space-y-8 text-white"
    >
      {/* top note */}
      <div className="bg-emerald-600 text-black p-4 rounded-lg flex items-center gap-3">
        <Settings size={18} />
        <span className="text-sm">
          <strong>Note:</strong> Settings saved in database and are synced to your account.
        </span>
      </div>

      {/* ─────── MEV PROTECTION TOGGLE ─────── */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldAlert size={18} className="text-cyan-400" />
          MEV Protection
          <SettingsTooltip name="mevMode" />
        </h3>

        <div className="grid grid-cols-2 gap-2 text-sm font-medium">
          <button
            onClick={() => persist({ ...prefs, mevMode: "fast" })}
            className={
              `flex items-center justify-center gap-1 py-2 rounded-lg transition ` +
              (prefs.mevMode === "fast"
                ? "bg-emerald-600 text-black shadow-inner"
                : "bg-zinc-900 border border-zinc-700 hover:border-emerald-500/40")
            }
          >
            <Zap size={14} /> Fast
          </button>

          <button
            onClick={() => persist({ ...prefs, mevMode: "secure" })}
            className={
              `flex items-center justify-center gap-1 py-2 rounded-lg transition ` +
              (prefs.mevMode === "secure"
                ? "bg-emerald-600 text-black shadow-inner"
                : "bg-zinc-900 border border-zinc-700 hover:border-emerald-500/40")
            }
          >
            <ShieldCheck size={14} /> Secure
          </button>
        </div>
      </div>

      {/* ─────── GENERAL TOGGLES ─────── */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldAlert size={18} className="text-emerald-400" />
          General Settings
        </h3>

        {[
          { label: "Confirm Before Trade", path: "confirmBeforeTrade" },
          { label: "Telegram Alerts",      path: "alertsEnabled"      },
          { label: "Auto-Buy Enabled",     path: "autoBuy.enabled"    },
        ].map(({ label, path }) => {
          const [root, sub] = path.split(".");
          const val = sub ? prefs[root][sub] : prefs[root];
          const onToggle = v => {
            if (path === "autoBuy.enabled" && !v) {
              /* turn OFF auto-buy → zero amount & clear input */
              persist({
                ...prefs,
                autoBuy: { enabled: false, amount: 0 },
              });
              setDraftAuto("");
              return;
            }
            persist(applyPath(prefs, path, v));
          };

          return (
            <div
              key={path}
              className="flex items-center justify-between bg-zinc-900 border border-zinc-700 rounded-md px-4 py-3 hover:border-emerald-500/50 transition"
            >
              <span className="text-sm font-medium flex items-center gap-2">
                {label}
                <SettingsTooltip name={path} />
              </span>

              <Switch.Root
                id={path}
                aria-label={label}
                checked={val}
                onCheckedChange={onToggle}
                className="relative h-5 w-9 data-[state=checked]:bg-emerald-600 bg-red-600 rounded-full shadow-inner transition-colors outline-none cursor-pointer ring-offset-2 focus:ring-2 focus:ring-emerald-500"
              >
                <Switch.Thumb className="block h-4 w-4 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[19px]" />
              </Switch.Root>
            </div>
          );
        })}
      </div>

      {/* ─────── NUMERIC PREFERENCES ─────── */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <DollarSign size={18} className="text-cyan-400" />
          Numeric Preferences
        </h3>

        <NumericInput
          id="autoBuyAmount"
          label="Auto-Buy Amount (SOL)"
          value={draftAuto}
          onChange={setDraftAuto}
          showCheck={autoChanged}
          onSave={saveAuto}
        />

        <NumericInput
          id="defaultSlippage"
          label="Default Slippage (%)"
          value={draftSlip}
          onChange={setDraftSlip}
          showCheck={slipChanged}
          onSave={saveSlip}
          icon={<Percent size={14} className="text-zinc-400" />}
        />

        <NumericInput
          id="defaultMaxSlippage"
          label="Max Slippage Ceiling (%)"
          value={draftDefaultSlip}
          onChange={setDraftDefaultSlip}
          showCheck={maxSlipChanged}
          onSave={saveMaxSlip}
        />

        <NumericInput
          id="defaultPriorityFee"
          label="Priority Fee (μLAM)"
          value={draftPriorityFee}
          onChange={setDraftPriorityFee}
          showCheck={prioChanged}
          onSave={savePriority}
          step={100}
        />

        <NumericInput
          id="validatorBribe"
          label="Validator Bribe (SOL)"
          value={draftBribe}
          onChange={setDraftBribe}
          showCheck={bribeChanged}
          onSave={saveBribe}
          step={0.001}
        />
      </div>
    </motion.section>
  );
}

/* ─────────────────────────── Numeric Input ─────────────────────────── */
function NumericInput({
  id,
  label,
  value,
  onChange,
  onSave,
  showCheck,
  step = 0.01,
  icon = null,
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="text-sm font-medium text-zinc-300 flex items-center gap-2"
      >
        {icon} {label}
        <SettingsTooltip name={id} />
      </label>

      <div className="relative">
        <input
          id={id}
          type="number"
          step={step}
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => showCheck && onSave()}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-4 pr-7 py-2 text-right focus:ring-2 focus:ring-emerald-500 outline-none"
        />

        <GlowButton show={showCheck} onClick={onSave}>
          <Check size={14} />
        </GlowButton>
      </div>
    </div>
  );
}
