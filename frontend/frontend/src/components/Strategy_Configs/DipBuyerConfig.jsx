// DipBuyerConfig.jsx  ✨ now includes a Strategy Summary card
import React, { useMemo } from "react";
import StrategyTooltip from "./StrategyTooltip";
import AdvancedSection from "../ui/AdvancedSection";
import { ChevronDown } from "lucide-react";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields from "../ui/AdvancedFields"

export const REQUIRED_FIELDS = [
  "dipThreshold",
  "volumeThreshold",
    "recoveryWindow",   
  "volumeWindow",
];

/* feed selector options for summary ----------------------------------- */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

const DipBuyerConfig = ({ config = {}, setConfig, disabled, children  }) => {
  const defaults = {
    dipThreshold    : 5,
    recoveryWindow  : "5m",
    volumeThreshold : 10_000,
    volumeWindow    : "1h",
    tokenFeed       : "new",
    monitoredTokens : "",
    overrideMonitored: false,
    minMarketCap    : "",
    maxMarketCap    : "",
    minTokenAgeMinutes: "",
    maxTokenAgeMinutes: "",
  };
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  

  const recoveryWindows = ["1m", "5m", "30m"];
  const volumeWindows   = [ "30m", "1h", "2h", "4h" ];

  const summaryRecoveryWindow = recoveryWindows.includes(merged.recoveryWindow) ? merged.recoveryWindow : recoveryWindows[0];
  const summaryVolumeWindow = volumeWindows.includes(merged.volumeWindow) ? merged.volumeWindow : volumeWindows[0];
  const summaryTokenList = merged.overrideMonitored
    ? "📝 My Monitored"
    : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        ["recoveryWindow", "volumeWindow"].includes(name)
          ? value
          : value === ""
          ? ""
          : parseFloat(value),
    }));
  };

  const inputClasses =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 bg-zinc-900 " +
    "text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 " +
    "hover:border-emerald-500 transition-all";

  return (
    <>
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-4">
        💧 This strategy patiently waits for sharp dips, then buys recovering tokens once they bounce — perfect for catching quick rebounds after market flushes.
      </div>

      {/* Dip % + Recovery Window */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <div className="flex items-center gap-1">
            Dip Threshold (% Drop) <StrategyTooltip name="dipThreshold" />
          </div>
          <input
            type="number"
            name="dipThreshold"
            step="any"
            value={merged.dipThreshold}
            onChange={handleChange}
            placeholder="e.g. 5"
            disabled={disabled}
            className={inputClasses}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <div className="flex items-center gap-1">
            Recovery Window <StrategyTooltip name="recoveryWindow" />
          </div>
          <div className="relative">
            <select
              name="recoveryWindow"
              value={merged.recoveryWindow}
              onChange={handleChange}
              disabled={disabled}
              className={`${inputClasses} appearance-none pr-10`}
            >
              {recoveryWindows.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
          </div>
        </label>
      </div>

      {/* Volume floor + window */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <div className="flex items-center gap-1">
            Volume Floor (USD) <StrategyTooltip name="volumeThresholdUSD" />
          </div>
          <input
            type="number"
            name="volumeThreshold"
            step="any"
            value={merged.volumeThreshold}
            onChange={handleChange}
            placeholder="e.g. 10000"
            disabled={disabled}
            className={inputClasses}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <div className="flex items-center gap-1">
            Volume Window <StrategyTooltip name="volumeWindow" />
          </div>
          <div className="relative">
            <select
              name="volumeWindow"
              value={merged.volumeWindow}
              onChange={handleChange}
              disabled={disabled}
              className={`${inputClasses} appearance-none pr-10`}
            >
              {volumeWindows.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
          </div>
        </label>
      </div>

      {/* Token feed + advanced */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled} />
      <AdvancedFields config={merged} setConfig={setConfig} disabled={disabled} />
      {children}

      {/* Strategy summary */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊 <span className="text-pink-400 font-semibold">Dip Summary</span> — 
          List:&nbsp;<span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;&nbsp;
          Dip&nbsp;≥&nbsp;<span className="text-emerald-300 font-semibold">{merged.dipThreshold}%</span>;
          Recovery&nbsp;<span className="text-indigo-300 font-semibold">{summaryRecoveryWindow}</span>;
          Volume&nbsp;≥&nbsp;<span className="text-emerald-300 font-semibold">
            ${(+merged.volumeThreshold).toLocaleString()}
          </span>&nbsp;in&nbsp;
          <span className="text-indigo-300 font-semibold">{summaryVolumeWindow}</span>
          {merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes ? (
            <>; Age&nbsp;
              {merged.minTokenAgeMinutes && (
                <>≥ <span className="text-rose-300 font-semibold">{merged.minTokenAgeMinutes}m</span></>
              )}
              {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
              {merged.maxTokenAgeMinutes && (
                <>≤ <span className="text-rose-300 font-semibold">{merged.maxTokenAgeMinutes}m</span></>
              )}
            </>
          ) : null}
          {merged.minMarketCap || merged.maxMarketCap ? (
            <>; MC&nbsp;
              {merged.minMarketCap && (
                <>≥ <span className="text-orange-300 font-semibold">
                  ${(+merged.minMarketCap).toLocaleString()}
                </span></>
              )}
              {merged.minMarketCap && merged.maxMarketCap && " / "}
              {merged.maxMarketCap && (
                <>≤ <span className="text-orange-300 font-semibold">
                  ${(+merged.maxMarketCap).toLocaleString()}
                </span></>
              )}
            </>
          ) : null}
        </p>
      </div>
    </>
  );
};

export default DipBuyerConfig;
