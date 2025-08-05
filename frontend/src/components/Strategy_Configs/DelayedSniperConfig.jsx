// DelayedSniperConfig.jsx  ✨ now includes a Strategy Summary card
import React, { useMemo } from "react";
import StrategyTooltip    from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields     from "../ui/AdvancedFields";
import { ChevronDown }    from "lucide-react";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

export const REQUIRED_FIELDS = ["delayMs"];

export const OPTIONAL_FIELDS = [
  "priceWindow",
  "volumeWindow",
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "tokenFeed",
  "monitoredTokens",
  "overrideMonitored",
];

const DelayedSniperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* —— defaults —— */
  const defaults = {
    delayMs           : 15_000,
    entryThreshold    : 2,
    volumeThreshold   : 20_000,
    priceWindow       : "5m",
    volumeWindow      : "1h",
    tokenFeed         : "new",
    monitoredTokens   : "",
    overrideMonitored : false,
    minMarketCap      : "",
    maxMarketCap      : "",
  };
  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* —— dropdown options —— */
  const priceWindows  = ["1m", "5m", "15m", "30m", "1h"];
  const volumeWindows = ["1m", "5m", "30m", "1h", "4h", "8h"];

  /* —— clamps for summary —— */
  const summaryPriceWindow = priceWindows.includes(merged.priceWindow) ? merged.priceWindow : priceWindows[0];
  const summaryVolumeWindow = volumeWindows.includes(merged.volumeWindow) ? merged.volumeWindow : volumeWindows[0];
  const summaryTokenList = merged.overrideMonitored
    ? "📝 My Monitored"
    : (feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom");

  /* —— change handler —— */
  const change = ({ target }) =>
    setConfig((p) => ({
      ...p,
      [target.name]:
        ["priceWindow", "volumeWindow"].includes(target.name)
          ? target.value
          : target.value === ""
          ? ""
          : parseFloat(target.value),
    }));

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  /* ========================================================= */
  return (
    <>
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-3">
        ⏱️ This strategy delays its entry after spotting fresh mints, allowing liquidity and volatility to settle before buying — great for safer snipes on brand new tokens.
      </div>

      {/* —— Delay field —— */}
      <label className="flex flex-col text-sm font-medium gap-1 mb-4">
        <span className="flex items-center gap-1">
          Delay Before Buy (ms) <StrategyTooltip name="delayMs" />
        </span>
        <input
          type="number"
          name="delayMs"
          value={merged.delayMs}
          onChange={change}
          placeholder="e.g. 15000"
          disabled={disabled}
          className={inp}
        />
      </label>

      {/* —— Threshold & windows —— */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Pump Threshold (%) <StrategyTooltip name="entryThreshold" />
          </span>
          <input
            type="number"
            name="entryThreshold"
            value={merged.entryThreshold}
            onChange={change}
            placeholder="e.g. 2"
            disabled={disabled}
            className={inp}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Pump Time Window <StrategyTooltip name="priceWindow" />
          </span>
          <div className="relative">
            <select
              name="priceWindow"
              value={merged.priceWindow}
              onChange={change}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              {priceWindows.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
          </div>
        </label>
      </div>

      {/* —— Volume filter —— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Volume Floor (USD) <StrategyTooltip name="volumeThreshold" />
          </span>
          <input
            type="number"
            name="volumeThreshold"
            value={merged.volumeThreshold}
            onChange={change}
            placeholder="e.g. 20000"
            disabled={disabled}
            className={inp}
          />
        </label>

        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Volume Time Window <StrategyTooltip name="volumeWindow" />
          </span>
          <div className="relative">
            <select
              name="volumeWindow"
              value={merged.volumeWindow}
              onChange={change}
              disabled={disabled}
              className={`${inp} appearance-none pr-10`}
            >
              {volumeWindows.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
          </div>
        </label>
      </div>

      {/* —— Token feed / monitored list —— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled} />

      {/* —— Advanced fields —— */}
      <AdvancedFields
        config={merged}
        setConfig={setConfig}
        disabled={disabled}
      />

      {children}

      {/* —— Strategy summary —— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          📊 <span className="text-pink-400 font-semibold">Delayed Sniper Summary</span> — 
          ⏱ Delay: <span className="text-emerald-300 font-semibold">{merged.delayMs}ms</span>;
          List:&nbsp;<span className="text-emerald-300 font-semibold">{summaryTokenList}</span>;&nbsp;
          Pump&nbsp;≥&nbsp;<span className="text-emerald-300 font-semibold">{merged.entryThreshold}%</span> in&nbsp;
          <span className="text-indigo-300 font-semibold">{summaryPriceWindow}</span>; Volume&nbsp;≥&nbsp;
          <span className="text-emerald-300 font-semibold">
            ${(+merged.volumeThreshold).toLocaleString()}
          </span> in&nbsp;
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

export default DelayedSniperConfig;
