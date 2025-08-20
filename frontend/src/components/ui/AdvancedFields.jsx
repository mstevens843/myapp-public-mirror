// AdvancedFields.jsx — Turbo-style solid fields + transparent inputs
import React, { useCallback, useMemo } from "react";
import AdvancedSection from "./AdvancedSection";
import StrategyTooltip from "../Strategy_Configs/StrategyTooltip";
import { ChevronDown } from "lucide-react";

// Instrumentation helpers (no-ops unless BREAKOUT_DEBUG=1 in localStorage)
import { logChange, logBlur, logEffect } from "../../dev/inputDebug";

/**
 * Field registry for Advanced.
 * - Add `strategies: [...]` to a field to show it ONLY for those strategies.
 * - Omit `strategies` to show for all strategies.
 * 
 * NOTE: This keeps everything inline (no extra files) but gives you per-strategy
 *       control in one place. Today we add Token Age only for `sniper`.
 */
const FIELD_DEFS = [
  { label: "Min Market-Cap (USD)",      name: "minMarketCap",        placeholder: "e.g. 100000" },
  { label: "Max Market-Cap (USD)",      name: "maxMarketCap",        placeholder: "e.g. 2000000" },

  // 🔽 Token age moved here (Advanced) and gated to sniper only for now
  { label: "Min Token Age (min)",       name: "minTokenAgeMinutes",  placeholder: "e.g. 60",   strategies: ["sniper"] },
  { label: "Max Token Age (min)",       name: "maxTokenAgeMinutes",  placeholder: "e.g. 1440", strategies: ["sniper"] },

  // Other commonly shared advanced knobs (kept for backwards-compat)
  { label: "Halt on Fails (#)",         name: "haltOnFailures",      placeholder: "e.g. 5" },
  { label: "Per-token Cooldown (s)",    name: "cooldown",            placeholder: "e.g. 30" },
  { label: "Max Slippage (%)",          name: "maxSlippage",         placeholder: "e.g. 0.5" },
  { label: "Priority Fee (μlam)",       name: "priorityFeeLamports", placeholder: "e.g. 20000" },
  { label: "Bribery (SOL)",             name: "briberyAmount",       placeholder: "e.g. 0.002" },
  { label: "MEV Mode",                  name: "mevMode",             placeholder: "fast / secure" },
  { label: "TP Sell Amount (%)",        name: "tpPercent",           placeholder: "e.g. 100" },
  { label: "SL Sell Amount (%)",        name: "slPercent",           placeholder: "e.g. 100" },
];

export default function AdvancedFields({
  config = {},
  setConfig,
  disabled = false,
  fields,               // optional override list: [{label,name,placeholder}] (bypasses strategy gating)
  strategy,             // optional: e.g. "sniper" to include gated fields
  className = "",
}) {
  // Determine which fields to render
  const usedFields = useMemo(() => {
    if (fields && Array.isArray(fields)) return fields;
    // Strategy-gated filtering
    return FIELD_DEFS.filter(def => {
      if (!def.strategies) return true; // shared field
      if (!strategy) return false;      // gated field but no strategy provided
      return def.strategies.includes(String(strategy));
    });
  }, [fields, strategy]);

  // Build a "view" model: force numbers to display as strings so typing works.
  const view = useMemo(() => {
    const v = { ...config };
    usedFields.forEach(({ name }) => {
      const val = config[name];
      if (val === "" || val === null || val === undefined) {
        v[name] = "";
      } else {
        v[name] = String(val);
      }
    });
    return v;
  }, [config, usedFields]);

  // Change handler: always set raw string or select value
  const handleChange = useCallback(
    (e) => {
      const { name, type, value, checked } = e.currentTarget;
      const next = type === "checkbox" ? !!checked : value;
      setConfig((prev) => {
        const updated = { ...(prev ?? {}) };
        updated[name] = next;
        return updated;
      });
      logChange({
        comp: "AdvancedFields",
        field: name,
        raw: value,
        prev: config[name],
        next,
      });
    },
    [setConfig, config]
  );

  // Blur handler: coerce strings → numbers unless RAW_INPUT_MODE is active
  const handleBlur = useCallback(
    (field) => (e) => {
      const raw = e?.currentTarget?.value ?? "";
      const before = config[field];
      const isRawInputMode =
        typeof window !== "undefined" &&
        window.localStorage?.BREAKOUT_RAW_INPUT_MODE === "1";

      if (isRawInputMode) {
        logBlur({ comp: "AdvancedFields", field, before, after: raw });
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
      logBlur({ comp: "AdvancedFields", field, before, after });
    },
    [setConfig, config]
  );

  /* Styling classes (Turbo/Sniper solid field look) */
  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 " +
    "px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 " +
    "focus-within:ring-2 focus-within:ring-emerald-500/20 transition";

  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 " +
    "outline-none border-none focus:outline-none";

  return (
    <AdvancedSection title="Advanced (optional)" className={className}>
      <div className="grid sm:grid-cols-2 gap-4">
        {usedFields.map(({ label, name, placeholder }) => (
          <label key={name} className="flex flex-col gap-1 text-sm font-medium">
            <div className="flex items-center gap-1 text-zinc-300">
              {label}
              <StrategyTooltip name={name} />
            </div>

            {name === "mevMode" ? (
              <div className={fieldWrap}>
                <select
                  name="mevMode"
                  value={view.mevMode ?? ""}
                  onChange={handleChange}
                  disabled={disabled}
                  className={`${inp} appearance-none pr-8`}
                >
                  <option value="">— default —</option>
                  <option value="fast">fast</option>
                  <option value="secure">secure</option>
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            ) : (
              <div className={fieldWrap}>
                <input
                  type="text"
                  inputMode="decimal"
                  name={name}
                  value={view[name] ?? ""}
                  onChange={handleChange}
                  onBlur={handleBlur(name)}
                  placeholder={placeholder}
                  disabled={disabled}
                  className={inp}
                />
              </div>
            )}
          </label>
        ))}
      </div>
    </AdvancedSection>
  );
}
