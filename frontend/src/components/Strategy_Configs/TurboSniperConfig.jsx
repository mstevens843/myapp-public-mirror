// TurboSniperConfig.jsx — Turbo + Full Sniper Additions + Strategy Summary
import React, { useMemo } from "react";
import StrategyTooltip     from "./StrategyTooltip";
import TokenSourceSelector from "./TokenSourceSelector";
import AdvancedFields      from "../ui/AdvancedFields";
import { ChevronDown }     from "lucide-react";

/* feed selector options ------------------------------------------------ */
const feedOptions = [
  { value: "new",      label: "New listings" },
  { value: "trending", label: "Trending tokens" },
  { value: "all",      label: "All tokens (premium)" },
];

/* fields surfaced in Advanced / Summary -------------------------------- */
export const OPTIONAL_FIELDS = [
  "priceWindow", "volumeWindow",
  "minTokenAgeMinutes", "maxTokenAgeMinutes",
  "minMarketCap", "maxMarketCap",
  "tokenFeed", "monitoredTokens", "overrideMonitored",
  // turbo / risk
  "turboMode", "autoRiskManage", "privateRpcUrl",
  // jito / fees
  "useJitoBundle", "jitoTipLamports", "jitoRelayUrl", "autoPriorityFee",
  // rpc / safety
  "rpcEndpoints", "rpcMaxErrors", "killSwitch", "killThreshold", "poolDetection",
  // dex prefs / split / exits
  "allowedDexes", "excludedDexes", "splitTrade", "tpLadder", "trailingStopPct",
];

/* fields required by validator ----------------------------------------
 * Turbo Sniper shares the same required fields as the base Sniper: the
 * pump entry % and minimum volume.  Additional turbo toggles are optional.
 */
export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

const turboSniperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* sensible defaults (mirror Sniper, plus turbo toggles) */
  const defaults = {
    entryThreshold       : 3,
    volumeThreshold      : 50_000,
    priceWindow          : "1h",
    volumeWindow         : "24h",
    tokenFeed            : "new",
    monitoredTokens      : "",
    overrideMonitored    : false,

    minTokenAgeMinutes   : "",
    maxTokenAgeMinutes   : "",
    minMarketCap         : "",
    maxMarketCap         : "",

    dipThreshold         : "",
    delayBeforeBuyMs     : "",
    priorityFeeLamports  : "",

    // MEV prefs
    mevMode              : "fast",     // or "secure"
    briberyAmount        : 0.002,      // SOL

    // Advanced sniper flags
    ghostMode            : false,
    coverWalletId        : "",
    multiBuy             : false,
    multiBuyCount        : 2,
    prewarmAccounts      : false,
    multiRoute           : false,
    autoRug              : false,

    // Premium / execution flags
    useJitoBundle        : false,
    autoPriorityFee      : false,
    jitoTipLamports      : "",
    jitoRelayUrl         : "",
    poolDetection        : false,

    // Safety
    killSwitch           : false,
    killThreshold        : 3,

    // RPC
    rpcEndpoints         : "",
    rpcMaxErrors         : 3,

    // DEX prefs
    allowedDexes         : "",
    excludedDexes        : "",
    splitTrade           : false,

    // Exit helpers
    tpLadder             : "",  // e.g. "25,25,50"
    trailingStopPct      : "",

    // Turbo-specific
    turboMode            : false,
    autoRiskManage       : false,
    privateRpcUrl        : "",
  };

  const merged = useMemo(() => ({ ...defaults, ...(config ?? {}) }), [config]);

  /* generic change handler */
  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : [
              "priceWindow",
              "volumeWindow",
              "recoveryWindow",
              "coverWalletId",
              "rpcEndpoints",
              "allowedDexes",
              "excludedDexes",
              "tpLadder",
              "jitoRelayUrl",
              "privateRpcUrl",
            ].includes(name)
          ? value
          : value === "" ? "" : parseFloat(value),
    }));
  };

  /* select options */
  const priceWins  = ["", "1m","5m","15m","30m","1h","2h","4h","6h"];
  const volumeWins = ["", "1m","5m","30m","1h","4h","8h","24h"];

  const inp =
    "w-full min-h-[34px] text-sm pl-3 pr-8 py-2 rounded-md border border-zinc-700 " +
    "bg-zinc-900 text-white placeholder:text-zinc-400 focus:outline-none " +
    "focus:ring-2 focus:ring-emerald-400 hover:border-emerald-500 transition";

  /* ==================================================================== */
  return (
    <>
      {/* ——— description ——— */}
      <div className="bg-zinc-800/70 text-zinc-300 text-xs rounded-md p-2 mb-3">
        This strategy hunts early-stage listings, letting you tune price &amp; volume
        windows, token age, and more to precision-snipe brand-new or trending tokens.
      </div>

      {/* ——— thresholds ——— */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Pump Threshold (%) <StrategyTooltip name="entryThreshold" />
          </span>
          <input
            type="number"
            name="entryThreshold"
            step="any"
            value={merged.entryThreshold}
            onChange={change}
            placeholder="e.g. 3"
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
              className={`${inp} appearance-none pr-10`}
            >
              <option value="">None</option>
              {priceWins.slice(1).map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* ——— volume filters ——— */}
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
            disabled={disabled}
            placeholder="e.g. 50000"
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
              <option value="">None</option>
              {volumeWins.slice(1).map((w) => <option key={w}>{w}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none"/>
          </div>
        </label>
      </div>

      {/* ——— token age (min/max) ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {["min","max"].map((k) => (
          <label key={k} className="flex flex-col text-sm font-medium gap-1">
            <span className="flex items-center gap-1">
              {k === "min" ? "Min" : "Max"} Token Age (min)
              <StrategyTooltip name={`${k}TokenAgeMinutes`} />
            </span>
            <input
              type="number"
              name={`${k}TokenAgeMinutes`}
              value={merged[`${k}TokenAgeMinutes`] ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="e.g. 60"
              className={inp}
            />
          </label>
        ))}
      </div>

      {/* ——— Advanced Sniper Flags ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {/* Ghost mode */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="ghostMode"
            checked={!!merged.ghostMode}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Ghost Mode (forward to cover) <StrategyTooltip name="ghostMode" />
        </label>
        {merged.ghostMode && (
          <input
            type="text"
            name="coverWalletId"
            value={merged.coverWalletId || ""}
            onChange={change}
            disabled={disabled}
            placeholder="Cover wallet ID"
            className={inp}
          />
        )}
      </div>

      {/* Multi-buy */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="multiBuy"
            checked={!!merged.multiBuy}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Parallel Multi-Buy <StrategyTooltip name="multiBuy" />
        </label>
        {merged.multiBuy && (
          <input
            type="number"
            name="multiBuyCount"
            min="1"
            max="3"
            value={merged.multiBuyCount}
            onChange={change}
            disabled={disabled}
            placeholder="Count (1–3)"
            className={inp}
          />
        )}
      </div>

      {/* Pre-warm / Rug / Multi-route */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="prewarmAccounts"
            checked={!!merged.prewarmAccounts}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Pre-Warm Accounts <StrategyTooltip name="prewarmAccounts" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="autoRug"
            checked={!!merged.autoRug}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Auto Rug Detection <StrategyTooltip name="autoRug" />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="multiRoute"
            checked={!!merged.multiRoute}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Multi-Route Aggregation <StrategyTooltip name="multiRoute" />
        </label>
      </div>

      {/* ——— Jito bundle & fee tuning ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="useJitoBundle"
            checked={!!merged.useJitoBundle}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Use Jito Bundle <StrategyTooltip name="useJitoBundle" />
        </label>
        {merged.useJitoBundle && (
          <div className="flex flex-col gap-2">
            <input
              type="number"
              name="jitoTipLamports"
              value={merged.jitoTipLamports ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="Tip Lamports (e.g. 1000)"
              className={inp}
            />
            <input
              type="text"
              name="jitoRelayUrl"
              value={merged.jitoRelayUrl ?? ""}
              onChange={change}
              disabled={disabled}
              placeholder="Custom Jito Relay URL"
              className={inp}
            />
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="autoPriorityFee"
            checked={!!merged.autoPriorityFee}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Auto Priority Fee <StrategyTooltip name="autoPriorityFee" />
        </label>
      </div>

      {/* ——— RPC & Kill Switch ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            RPC Endpoints (comma) <StrategyTooltip name="rpcEndpoints" />
          </span>
          <input
            type="text"
            name="rpcEndpoints"
            value={merged.rpcEndpoints ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="https://rpc1, https://rpc2"
            className={inp}
          />
        </label>
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            RPC Max Errors <StrategyTooltip name="rpcMaxErrors" />
          </span>
          <input
            type="number"
            name="rpcMaxErrors"
            min="1"
            value={merged.rpcMaxErrors ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 3"
            className={inp}
          />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="killSwitch"
            checked={!!merged.killSwitch}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Kill Switch <StrategyTooltip name="killSwitch" />
        </label>
        {merged.killSwitch && (
          <input
            type="number"
            name="killThreshold"
            min="1"
            value={merged.killThreshold ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="Fails threshold"
            className={inp}
          />
        )}
      </div>

      {/* ——— Pool detection ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="poolDetection"
            checked={!!merged.poolDetection}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Pool Detection <StrategyTooltip name="poolDetection" />
        </label>
      </div>

      {/* ——— DEX prefs & split ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Allowed DEXes <StrategyTooltip name="allowedDexes" />
          </span>
          <input
            type="text"
            name="allowedDexes"
            value={merged.allowedDexes ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. Raydium,Orca,Meteora"
            className={inp}
          />
        </label>
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Excluded DEXes <StrategyTooltip name="excludedDexes" />
          </span>
          <input
            type="text"
            name="excludedDexes"
            value={merged.excludedDexes ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. Step,Crema"
            className={inp}
          />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="splitTrade"
            checked={!!merged.splitTrade}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Split Trade (multi-pool) <StrategyTooltip name="splitTrade" />
        </label>
      </div>

      {/* ——— TP Ladder & Trailing Stop ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            TP Ladder (%) <StrategyTooltip name="tpLadder" />
          </span>
          <input
            type="text"
            name="tpLadder"
            value={merged.tpLadder ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 25,25,50"
            className={inp}
          />
        </label>
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Trailing Stop (%) <StrategyTooltip name="trailingStopPct" />
          </span>
          <input
            type="number"
            name="trailingStopPct"
            value={merged.trailingStopPct ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="e.g. 10"
            className={inp}
          />
        </label>
      </div>

      {/* ——— Turbo & Risk Options ——— */}
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {/* Turbo execution toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="turboMode"
            checked={!!merged.turboMode}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Turbo Mode <StrategyTooltip name="turboMode" />
        </label>
        {/* Auto risk management toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="autoRiskManage"
            checked={!!merged.autoRiskManage}
            onChange={change}
            disabled={disabled}
            className="accent-emerald-500"
          />
          Auto Risk Manage <StrategyTooltip name="autoRiskManage" />
        </label>
      </div>
      {/* Private RPC URL input */}
      <div className="grid sm:grid-cols-1 gap-4 mt-4">
        <label className="flex flex-col text-sm font-medium gap-1">
          <span className="flex items-center gap-1">
            Private RPC URL <StrategyTooltip name="privateRpcUrl" />
          </span>
          <input
            type="text"
            name="privateRpcUrl"
            value={merged.privateRpcUrl ?? ""}
            onChange={change}
            disabled={disabled}
            placeholder="https://example-rpc"
            className={inp}
          />
        </label>
      </div>

      {/* ——— Token feed selector, Advanced, children ——— */}
      <TokenSourceSelector config={config} setConfig={setConfig} disabled={disabled}/>
      <AdvancedFields      config={merged} setConfig={setConfig} disabled={disabled}/>
      {children}

      {/* ——— STRATEGY SUMMARY ——— */}
      <div className="mt-6 bg-zinc-800/70 rounded-md p-3">
        <p className="text-xs text-right leading-4">
          <span className="text-pink-400 font-semibold">Sniper Summary</span> — List:&nbsp;
          {merged.overrideMonitored
            ? <span className="text-yellow-300 font-semibold">📝 My Monitored</span>
            : <span className="text-emerald-300 font-semibold">
                {feedOptions.find(f => f.value === merged.tokenFeed)?.label || "Custom"}
              </span>
          };&nbsp;
          Pump <span className="text-emerald-300 font-semibold">≥ {merged.entryThreshold}%</span>
          &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.priceWindow}</span>;
          &nbsp;Volume&nbsp;
          <span className="text-emerald-300 font-semibold">
            ≥ ${(+merged.volumeThreshold).toLocaleString()}
          </span>
          &nbsp;in&nbsp;<span className="text-indigo-300 font-semibold">{merged.volumeWindow}</span>
          { (merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes) ? (
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
          { (merged.minMarketCap || merged.maxMarketCap) ? (
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

          { (merged.ghostMode || merged.multiBuy || merged.prewarmAccounts ||
             merged.autoRug   || merged.multiRoute) && (
            <>; Flags&nbsp;
              {merged.ghostMode && <span className="text-emerald-300 font-semibold"> Ghost</span>}
              {merged.multiBuy && <span className="text-indigo-300 font-semibold">
                {" "}Multi{merged.multiBuyCount > 1 ? `×${merged.multiBuyCount}` : ""}
              </span>}
              {merged.prewarmAccounts && <span className="text-pink-300 font-semibold"> Prewarm</span>}
              {merged.autoRug && <span className="text-rose-300 font-semibold"> Rug</span>}
              {merged.multiRoute && <span className="text-yellow-300 font-semibold"> MultiRoute</span>}
            </>
          )}
          {merged.turboMode && <span>; Turbo <span className="text-emerald-300 font-semibold">On</span></span>}
          {merged.autoRiskManage && <span>; AutoRisk <span className="text-emerald-300 font-semibold">On</span></span>}
        </p>
      </div>
    </>
  );
};

export default turboSniperConfig;
