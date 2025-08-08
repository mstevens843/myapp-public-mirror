/**
 * SafetyChecksModal – v2.1
 * ------------------------------------------------------------
 * • Swaps Radix tooltip for a lightweight Info-icon hover card
 * • Re-uses the styling pattern from FieldTooltip.jsx
 * • Icons, quick-select presets, same props & state logic
 */
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switchModal";
import {
  X,
  ShieldCheck,
  Droplet,
  BadgeCheck,
  Users,
  Activity,
  Info,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* rule meta-data                                                             */
/* -------------------------------------------------------------------------- */
export const RULES = [
  {
    key: "simulation",
    label: "Detect Scam or Illiquid Token",
    desc: "Simulates a swap to catch honeypots, zero-liquidity, or slippage traps.",
    icon: Activity,
  },

  {
    key: "authority",
    label: "Check Mint and Freeze Authority",
    desc: "Blocks tokens with active mint or freeze authority (rug risk).",
    icon: ShieldCheck,
  },
    {
    key: "liquidity",
    label: "Ensure Liquidity Exists",
    desc: "Requires ≥ $50k pool depth and daily trade volume.",
    icon: Droplet,
  },

  {
    key: "topHolders",
    label: "Avoid Whale-Controlled Tokens",
    desc: "Blocks tokens where top 5 wallets control > 10% of supply.",
    icon: Users,
  },
];
const PRESETS = {
  Minimal: ["simulation", "authority"],
  Balanced: ["simulation", "liquidity", "authority"],
  Strict: RULES.map((r) => r.key),
};

export default function SafetyChecksModal({ open, onClose, checks, onSave }) {
  /* ───────── local draft (so Cancel doesn’t commit) ───────── */
  const [local, setLocal] = useState(checks);
  useEffect(() => setLocal(checks), [checks, open]);

  /* helpers */
  const toggle = (k) => setLocal((p) => ({ ...p, [k]: !p[k] }));
  const setPreset = (keys) =>
    setLocal(Object.fromEntries(RULES.map(({ key }) => [key, keys.includes(key)])));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-[380px] rounded-3xl bg-zinc-900/95 border border-zinc-700 p-7 text-white shadow-2xl space-y-6">
        {/* close icon */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white"
        >
          <X size={18} />
        </button>

        {/* title */}
        <h3 className="text-center text-xl font-bold text-indigo-400">
          Configure Safety&nbsp;Checks
        </h3>

        {/* switches grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-7">
          {RULES.map(({ key, label, desc, icon: Icon }) => (
            <div
              key={key}
              className="relative group flex flex-col items-center gap-1 text-sm"
            >
              {/* rule icon */}
              <Icon size={22} className="text-emerald-400" />

              {/* toggle */}
              <Switch
                checked={!!local[key]}
                onCheckedChange={() => toggle(key)}
                className="h-4 w-7"
              />

              {/* label + info */}
<div className="flex items-center justify-center gap-1.5 text-center">
                <span>{label}</span>
                <Info
                  size={14}
                  className="text-zinc-400 hover:text-emerald-300 cursor-pointer"
                />
              </div>

              {/* hover card (mirrors FieldTooltip style) */}
              <div
                className="absolute left-1/2 top-0 z-20 hidden w-max -translate-x-1/2 -translate-y-[105%]
                           rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs
                           text-white shadow-lg group-hover:block"
              >
                {desc}
              </div>
            </div>
          ))}
        </div>

        {/* presets */}
        <div className="flex items-center justify-center gap-3">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              onClick={() => setPreset(PRESETS[name])}
              className="rounded-full border border-zinc-600 px-3 py-[2px] text-xs
                         text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              {name}
            </button>
          ))}
        </div>

        {/* footer note */}
        <p className="text-[11px] text-zinc-400 text-center">
          Stricter settings protect funds but may
          <br />
          reduce fill rate on thin-liquidity pairs.
        </p>

        {/* actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded bg-zinc-700 px-4 py-[6px] text-xs text-zinc-200 hover:bg-zinc-600"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(local);
              onClose();
            }}
            className="rounded bg-emerald-600 px-4 py-[6px] text-xs font-medium hover:bg-emerald-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
