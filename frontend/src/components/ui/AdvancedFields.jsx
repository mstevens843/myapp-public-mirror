// AdvancedFields.jsx — Turbo-style solid fields + transparent inputs
import React from "react";
import AdvancedSection from "./AdvancedSection";
import StrategyTooltip from "../Strategy_Configs/StrategyTooltip";
import { ChevronDown } from "lucide-react";

/* Default advanced inputs (labels aligned with Turbo/Sniper UI) */
const BASE_FIELDS = [
  { label: "Min Market-Cap (USD)",      name: "minMarketCap",        placeholder: "e.g. 100000" },
  { label: "Max Market-Cap (USD)",      name: "maxMarketCap",        placeholder: "e.g. 2000000" },
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
  fields,               // optional override list
  className = "",
}) {
  const usedFields = fields || BASE_FIELDS;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        value === ""
          ? ""
          : name === "mevMode"
          ? value
          : parseFloat(value),
    }));
  };

  /* Solid container + transparent input pattern (matches Sniper/Turbo) */
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
                  value={config.mevMode ?? ""}
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
                  type="number"
                  name={name}
                  step="any"
                  value={config[name] ?? ""}
                  onChange={handleChange}
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
