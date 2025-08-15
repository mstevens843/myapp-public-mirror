// SniperConfig.jsx — Tabbed config: Core / Execution / Token List / Advanced
// Solid dark UI, emerald accents, “Ready” glowy state

import React, { useMemo, useState } from "react";
import StrategyTooltip from "./StrategyTooltip";
import TokenSourceSelector, { feedOptions as FEEDS } from "./TokenSourceSelector";
import AdvancedFields from "../ui/AdvancedFields";
import { ChevronDown } from "lucide-react";

/** fields */
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
];

export const REQUIRED_FIELDS = ["entryThreshold", "volumeThreshold"];

/* shared UI helpers */
const Card = ({ title, right, children, className = "" }) => (
  <div
    className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 sm:p-4 ${className}`}
  >
    {(title || right) && (
      <div className="mb-3 flex items-center justify-between">
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
      <span className="ml-2 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] text-white">
        {badge}
      </span>
    )}
  </button>
);

/** key mapping for badge counts */
const TAB_KEYS = {
  core: [
    "entryThreshold",
    "priceWindow",
    "volumeThreshold",
    "volumeWindow",
    "minTokenAgeMinutes",
    "maxTokenAgeMinutes",
    "minMarketCap",
    "maxMarketCap",
  ],
  execution: ["mevMode", "briberyAmount", "delayBeforeBuyMs", "priorityFeeLamports"],
  tokens: ["tokenFeed", "monitoredTokens", "overrideMonitored"],
  advanced: ["tpLadder", "trailingStopPct"], // example advanced-only
};

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
  const counts = { core: 0, execution: 0, tokens: 0, advanced: 0 };
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

const SniperConfig = ({ config = {}, setConfig, disabled, children }) => {
  /* defaults */
  const defaults = {
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

    // Timing & fees
    delayBeforeBuyMs: "",
    priorityFeeLamports: "",

    // MEV
    mevMode: "fast",
    briberyAmount: 0.002,

    // exits (advanced)
    tpLadder: "",
    trailingStopPct: "",
  };

  const merged = useMemo(() => ({ ...defaults, ...(config || {}) }), [config]);

  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : ["priceWindow", "volumeWindow"].includes(name)
          ? value
          : value === ""
          ? ""
          : isNaN(Number(value))
          ? value
          : parseFloat(value),
    }));
  };

  const priceWins = ["", "1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h"];
  const volumeWins = ["", "1m", "5m", "30m", "1h", "4h", "8h", "24h"];

  const fieldWrap =
    "relative rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 hover:border-zinc-800 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition";
  const inp =
    "w-full text-sm px-1.5 py-1.5 bg-transparent text-white placeholder:text-zinc-500 outline-none border-none focus:outline-none";

  const errors = validateSniperConfig(merged);
  const tabErr = countErrorsForTab(errors);

  const [activeTab, setActiveTab] = useState("core");
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);

  /* TABS */
  const CoreTab = () => (
    <Section>
      <Card title="Core Filters" className="sm:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Pump threshold */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Threshold (%)</span>
              <StrategyTooltip name="entryThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="entryThreshold"
                step="any"
                value={merged.entryThreshold}
                onChange={change}
                placeholder="e.g. 3"
                className={inp}
                disabled={disabled}
              />
            </div>
          </div>

          {/* Pump window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Pump Time Window</span>
              <StrategyTooltip name="priceWindow" />
            </div>
            <div className={fieldWrap}>
              <select
                name="priceWindow"
                value={merged.priceWindow}
                onChange={change}
                className={`${inp} appearance-none pr-8`}
                disabled={disabled}
              >
                <option value="">None</option>
                {priceWins.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-zinc-400" />
            </div>
          </div>

          {/* Volume floor */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Floor (USD)</span>
              <StrategyTooltip name="volumeThreshold" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="volumeThreshold"
                value={merged.volumeThreshold}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 50000"
                className={inp}
              />
            </div>
          </div>

          {/* Volume window */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Volume Time Window</span>
              <StrategyTooltip name="volumeWindow" />
            </div>
            <div className={fieldWrap}>
              <select
                name="volumeWindow"
                value={merged.volumeWindow}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="">None</option>
                {volumeWins.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-zinc-400" />
            </div>
          </div>
        </div>

        {!showRequiredOnly && (
          <>
            {/* Token age */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {["min", "max"].map((k) => (
                <div key={k} className="space-y-1">
                  <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                    <span>{k === "min" ? "Min" : "Max"} Token Age (min)</span>
                    <StrategyTooltip name={`${k}TokenAgeMinutes`} />
                  </div>
                  <div className={fieldWrap}>
                    <input
                      type="number"
                      name={`${k}TokenAgeMinutes`}
                      value={merged[`${k}TokenAgeMinutes`] ?? ""}
                      onChange={change}
                      disabled={disabled}
                      placeholder="e.g. 60"
                      className={inp}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Market cap */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Min Market Cap (USD)</span>
                  <StrategyTooltip name="minMarketCap" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="minMarketCap"
                    value={merged.minMarketCap ?? ""}
                    onChange={change}
                    disabled={disabled}
                    placeholder="e.g. 1000000"
                    className={inp}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
                  <span>Max Market Cap (USD)</span>
                  <StrategyTooltip name="maxMarketCap" />
                </div>
                <div className={fieldWrap}>
                  <input
                    type="number"
                    name="maxMarketCap"
                    value={merged.maxMarketCap ?? ""}
                    onChange={change}
                    disabled={disabled}
                    placeholder="e.g. 10000000"
                    className={inp}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </Section>
  );

  const ExecutionTab = () => (
    <Section>
      {/* Timing & Fees */}
      <Card title="Timing & Fees">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Delay Before Buy (ms)</span>
              <StrategyTooltip name="delayBeforeBuyMs" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="delayBeforeBuyMs"
                value={merged.delayBeforeBuyMs}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 5000"
                className={inp}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Priority Fee (μlam)</span>
              <StrategyTooltip name="priorityFeeLamports" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                name="priorityFeeLamports"
                value={merged.priorityFeeLamports}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 20000"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* MEV */}
      <Card title="MEV Preferences">
        <div className="grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>MEV Mode</span>
              <StrategyTooltip name="mevMode" />
            </div>
            <div className={fieldWrap}>
              <select
                name="mevMode"
                value={merged.mevMode}
                onChange={change}
                disabled={disabled}
                className={`${inp} appearance-none pr-8`}
              >
                <option value="fast">fast</option>
                <option value="secure">secure</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-zinc-400" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-300">
              <span>Bribery Lamports</span>
              <StrategyTooltip name="briberyAmount" />
            </div>
            <div className={fieldWrap}>
              <input
                type="number"
                step="0.0001"
                name="briberyAmount"
                value={merged.briberyAmount}
                onChange={change}
                disabled={disabled}
                placeholder="e.g. 0.002"
                className={inp}
              />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );

  const TokensTab = () => (
    <Section>
      <Card title="Token List" className="sm:col-span-2">
        <TokenSourceSelector
          config={merged}
          setConfig={setConfig}
          disabled={disabled}
        />
      </Card>
    </Section>
  );

  const AdvancedTab = () => (
    <>
      <Section>
        <Card title="Advanced" className="sm:col-span-2">
          <AdvancedFields
            config={merged}
            setConfig={setConfig}
            disabled={disabled}
          />
        </Card>
      </Section>
      {children}
    </>
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 text-zinc-200 shadow-xl">
      {/* Header + Tabs */}
      <div className="sticky top-0 z-[5] border-b border-zinc-900 bg-zinc-1000 p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Breakout Config
          </h2>

          {/* Required-only toggle */}
          <label className="flex select-none items-center gap-3">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={showRequiredOnly}
              onChange={(e) => setShowRequiredOnly(e.target.checked)}
            />
            <span className="relative inline-flex h-5 w-9 rounded-full bg-zinc-700 transition-colors peer-checked:bg-emerald-500">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs text-zinc-300 sm:text-sm">Required only</span>
          </label>
        </div>

        <div className="relative flex items-center gap-3 sm:gap-4">
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
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <div className="mb-4 rounded-md bg-zinc-900 p-2 text-xs text-zinc-300">
          🚀 Detects sudden price/volume break-outs on monitored or feed-selected
          tokens and enters early.
        </div>

        {errors.length > 0 && (
          <div className="mb-4 space-y-1 rounded-md border border-red-800 bg-red-900 p-2 text-xs text-red-100">
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {activeTab === "core" && <CoreTab />}
        {activeTab === "execution" && <ExecutionTab />}
        {activeTab === "tokens" && <TokensTab />}
        {activeTab === "advanced" && <AdvancedTab />}

        {/* Strategy Summary */}
        <div className="mt-6 rounded-md bg-zinc-900 p-3">
          <p className="text-right text-xs leading-4">
            <span className="font-semibold text-pink-400">Breakout Summary</span>{" "}
            — List:&nbsp;
            {merged.overrideMonitored ? (
              <span className="font-semibold text-yellow-300">
                📝 My Token List
              </span>
            ) : (
              <span className="font-semibold text-emerald-300">
                {FEEDS.find((f) => f.value === merged.tokenFeed)?.label ||
                  "Custom"}
              </span>
            )}
            ;&nbsp;Pump{" "}
            <span className="font-semibold text-emerald-300">
              ≥ {merged.entryThreshold}%
            </span>
            &nbsp;in&nbsp;
            <span className="font-semibold text-indigo-300">
              {merged.priceWindow}
            </span>
            ;&nbsp;Volume&nbsp;
            <span className="font-semibold text-emerald-300">
              ≥ ${(+merged.volumeThreshold).toLocaleString()}
            </span>
            &nbsp;in&nbsp;
            <span className="font-semibold text-indigo-300">
              {merged.volumeWindow}
            </span>
            {merged.minTokenAgeMinutes || merged.maxTokenAgeMinutes ? (
              <>
                ; Age&nbsp;
                {merged.minTokenAgeMinutes && (
                  <>
                    ≥{" "}
                    <span className="font-semibold text-rose-300">
                      {merged.minTokenAgeMinutes}m
                    </span>
                  </>
                )}
                {merged.minTokenAgeMinutes && merged.maxTokenAgeMinutes && " / "}
                {merged.maxTokenAgeMinutes && (
                  <>
                    ≤{" "}
                    <span className="font-semibold text-rose-300">
                      {merged.maxTokenAgeMinutes}m
                    </span>
                  </>
                )}
              </>
            ) : null}
            {merged.minMarketCap || merged.maxMarketCap ? (
              <>
                ; MC&nbsp;
                {merged.minMarketCap && (
                  <>
                    ≥{" "}
                    <span className="font-semibold text-orange-300">
                      ${(+merged.minMarketCap).toLocaleString()}
                    </span>
                  </>
                )}
                {merged.minMarketCap && merged.maxMarketCap && " / "}
                {merged.maxMarketCap && (
                  <>
                    ≤{" "}
                    <span className="font-semibold text-orange-300">
                      ${(+merged.maxMarketCap).toLocaleString()}
                    </span>
                  </>
                )}
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 rounded-b-2xl border-t border-zinc-900 bg-zinc-1000 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {errors.length > 0 ? (
              <span className="text-zinc-400">
                ⚠️ {errors.length} validation{" "}
                {errors.length === 1 ? "issue" : "issues"}
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
              onClick={() => setConfig((prev) => ({ ...defaults, ...(prev || {}) }))}
              disabled={disabled}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-700"
              title="Reset visible values to defaults (non-destructive merge)"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {}}
              disabled={disabled}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-700"
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SniperConfig;
