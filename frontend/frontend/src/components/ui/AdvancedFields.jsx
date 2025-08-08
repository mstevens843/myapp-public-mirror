import React from "react";
import AdvancedSection  from "./AdvancedSection";
import StrategyTooltip  from "../Strategy_Configs/StrategyTooltip";

/* ------------------------------------------------------------------ */
/* Default advanced inputs – user can override by passing `fields`    */
/* ------------------------------------------------------------------ */
const BASE_FIELDS = [
  { label: "Min Market-Cap (USD)",      name: "minMarketCap",        placeholder: "e.g. 100000" },
  { label: "Max Market-Cap (USD)",      name: "maxMarketCap",        placeholder: "e.g. 2 000 000" },
  { label: "Halt on Fails (#)",         name: "haltOnFailures",      placeholder: "e.g. 5" },
  { label: "Per-token Cooldown (s)",    name: "cooldown",            placeholder: "e.g. 30" },
  { label: "Max Slippage (%)",          name: "maxSlippage",         placeholder: "e.g. 0.5" },
  { label: "Priority Fee (lamports)",   name: "priorityFeeLamports", placeholder: "e.g. 20 000" },
  { label: "Bribery Amount (lamports)", name: "briberyAmount",       placeholder: "e.g. 250 000" },
  { label: "MEV Mode",                  name: "mevMode",             placeholder: "fast / secure" },
  { label: "TP Sell Amount (%)",        name: "tpPercent",           placeholder: "e.g. 100" },
  { label: "SL Sell Amount (%)",        name: "slPercent",           placeholder: "e.g. 100" },
];

/* ------------------------------------------------------------------ */

export default function AdvancedFields({
  config      = {},
  setConfig,
  disabled    = false,
  fields,                               // optional override list
  className   = "",
}) {
  const usedFields = fields || BASE_FIELDS;

  /* update helper */
  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        value === ""
          ? ""
          : name === "mevMode"
          ? value                              // keep string as-is
          : parseFloat(value),                 // numeric fields
    }));
  };

  /* basic input classes */
  const inputCls =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  return (
    <AdvancedSection title="Advanced (optional)" className={className}>
      {usedFields.map(({ label, name, placeholder }) => (
        <label key={name} className="mt-2 flex flex-col gap-1 text-sm font-medium">
          <div className="flex items-center gap-1">
            {label}
            <StrategyTooltip name={name} />
          </div>

          {/* special-case: MEV mode dropdown */}
          {name === "mevMode" ? (
            <select
              name="mevMode"
              value={config.mevMode ?? ""}
              onChange={handleChange}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">— default —</option>
              <option value="fast">fast</option>
              <option value="secure">secure</option>
            </select>
          ) : (
            <input
              type="number"
              name={name}
              step="any"
              value={config[name] ?? ""}
              onChange={handleChange}
              placeholder={placeholder}
              disabled={disabled}
              className={inputCls}
            />
          )}
        </label>
      ))}
    </AdvancedSection>
  );
}
