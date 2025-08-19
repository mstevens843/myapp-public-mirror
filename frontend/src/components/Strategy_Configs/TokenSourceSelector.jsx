// frontend/src/components/Strategy_Configs/TokenSourceSelector.jsx

// TokenSourceSelector.jsx — Two-pane "Variant B" layout (left radio list, right detail)
// Solid dark UI, emerald accents, inline chart illustration

import React, { useMemo, useCallback } from "react";
import StrategyTooltip from "./StrategyTooltip";
import {
  Rocket,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  Droplet,
  Bolt,
  Activity,
  ArrowLeftRight,
  Clock,
} from "lucide-react";

// Instrumentation (no-ops unless BREAKOUT_DEBUG=1 in localStorage)
import { logChange, logBlur } from "../../dev/inputDebug";

/** Shared feed catalog (exported so parent can read labels for summary) */
export const feedOptions = [
  {
    value: "new",
    label: "New listings",
    title: "Brand-new tokens as they appear on-chain (Birdeye feed).",
    icon: Rocket,
  },
  {
    value: "trending",
    label: "Trending tokens",
    title: "Highest 24h volume movers — liquidity + attention.",
    icon: TrendingUp,
  },

  /* ── New feeds (replacing old prefiltered ones) ───────────────────────────── */
  {
    value: "high-liquidity",
    label: "High Liquidity",
    title:
      "Pools with strong depth and tighter spreads—safer execution during volatility.",
    icon: Droplet,
  },
  {
    value: "mid-cap-growth",
    label: "Mid-Cap Growth",
    title:
      "Mid-cap tokens showing sustained growth and improving market structure.",
    icon: BarChart3,
  },
  {
    value: "price-surge",
    label: "Price Surge",
    title: "Fast movers with sharp intraday upside momentum.",
    icon: Bolt,
  },
  {
    value: "volume-spike",
    label: "Volume Spike",
    title: "Unusual activity flags—sudden increases in traded volume.",
    icon: Activity,
  },
  {
    value: "high-trade",
    label: "High Trade Count",
    title:
      "Tokens with elevated transaction count—broad participation / bot interest.",
    icon: ArrowLeftRight,
  },
  {
    value: "recent-good-liquidity",
    label: "Recently Listed + Liquidity",
    title:
      "Newly listed tokens that already have solid liquidity provision.",
    icon: Clock,
  },
];

export default function TokenSourceSelector({
  config,
  setConfig,
  disabled = false,
}) {
  const {
    tokenFeed = "new",
    overrideMonitored = false,
    monitoredTokens = "",
  } = config || {};

  const selectedFeed = useMemo(
    () => feedOptions.find((f) => f.value === tokenFeed) || feedOptions[0],
    [tokenFeed]
  );

  const tokenCount = useMemo(
    () =>
      (monitoredTokens || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean).length,
    [monitoredTokens]
  );

  // Functional setter that preserves other keys and plays nice with the
  // ConfigModal safeSetTempConfig (which preserves the active field).
  const set = useCallback(
    (patch) =>
      setConfig((p) => ({
        ...(p || {}),
        ...patch,
      })),
    [setConfig]
  );

  const onPickFeed = useCallback(
    (value) => {
      if (disabled || overrideMonitored) return;
      const prev = tokenFeed;
      set({ tokenFeed: value });
      logChange({
        comp: "TokenSourceSelector",
        field: "tokenFeed",
        prev,
        raw: value,
        next: value,
      });
    },
    [disabled, overrideMonitored, tokenFeed, set]
  );

  const onToggleOverride = useCallback(
    (checked) => {
      const prev = !!overrideMonitored;
      set({ overrideMonitored: checked });
      logChange({
        comp: "TokenSourceSelector",
        field: "overrideMonitored",
        prev,
        raw: checked,
        next: checked,
      });
    },
    [overrideMonitored, set]
  );

  const onChangeTokens = useCallback(
    (e) => {
      const value = e.target.value;
      const prev = monitoredTokens;
      // Write raw string; no coercion here (Breakout RAW mode + blur policies apply elsewhere)
      set({ monitoredTokens: value });
      logChange({
        comp: "TokenSourceSelector",
        field: "monitoredTokens",
        prev,
        raw: value,
        next: value,
      });
    },
    [monitoredTokens, set]
  );

  const onBlurTokens = useCallback(() => {
    logBlur({ comp: "TokenSourceSelector", field: "monitoredTokens" });
  }, []);

  return (
    <div className="mt-2 grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4">
      {/* LEFT: radio-card list */}
      <aside
        className={`rounded-lg border ${
          overrideMonitored ? "opacity-50" : ""
        } border-zinc-800 bg-zinc-900/80`}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <div className="text-xs font-medium text-zinc-300 flex items-center gap-1">
            Token Feeds <StrategyTooltip name="tokenFeed" />
          </div>
          {/* small “selected” indicator */}
          <div className="text-[10px] text-zinc-500">{selectedFeed.label}</div>
        </div>

        <div className="p-2 space-y-2">
          {feedOptions.map((f) => {
            const Icon = f.icon || TrendingUp;
            const active = tokenFeed === f.value;
            return (
              <button
                key={f.value}
                type="button"
                disabled={disabled || overrideMonitored}
                onClick={() => onPickFeed(f.value)}
                className={`w-full text-left group rounded-md border px-3 py-2 transition
                  ${
                    active
                      ? "border-emerald-500/70 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900"
                  } ${disabled ? "opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-4 w-4 rounded-full ring-1 ${
                        active
                          ? "bg-emerald-500 ring-emerald-400"
                          : "bg-zinc-800 ring-zinc-700 group-hover:ring-zinc-600"
                      }`}
                    />
                    <Icon
                      className={`h-4 w-4 ${
                        active ? "text-emerald-400" : "text-zinc-400"
                      }`}
                    />
                    <span
                      className={`text-sm ${
                        active ? "text-zinc-100" : "text-zinc-300"
                      }`}
                    >
                      {f.label}
                    </span>
                  </div>
                  {active && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-400">
                  {f.title}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT: details + custom list */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 sm:p-4">
        {/* Header: feed title + help */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(() => {
              const Icon = selectedFeed.icon || TrendingUp;
              return <Icon className="h-5 w-5 text-emerald-400" />;
            })()}
            <div className="text-sm font-medium text-zinc-200">
              {selectedFeed.label}
            </div>
          </div>
          <StrategyTooltip name="tokenFeed" />
        </div>

        {/* Illustration card */}
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          {/* Inline “chart” SVG to match the mock (no external asset) */}
          <svg viewBox="0 0 160 60" className="h-20 w-full" aria-hidden="true">
            <rect x="8" y="28" width="14" height="24" rx="2" className="fill-zinc-800" />
            <rect x="28" y="18" width="14" height="34" rx="2" className="fill-zinc-800" />
            <rect x="48" y="10" width="14" height="42" rx="2" className="fill-zinc-800" />
            <rect x="68" y="22" width="14" height="30" rx="2" className="fill-zinc-800" />
            <polyline
              points="6,44 24,36 44,20 64,30 84,16 102,26 120,10 140,18 154,8"
              fill="none"
              className="stroke-emerald-400"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>
          <p className="mt-1 text-[11px] text-zinc-400 leading-snug">
            {selectedFeed.title}
          </p>
        </div>

        {/* Override toggle */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-300">Use My Token List</span>
            <StrategyTooltip name="overrideMonitored" />
          </div>

          <label className="relative inline-flex h-5 w-9 items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={!!overrideMonitored}
              onChange={(e) => onToggleOverride(e.target.checked)}
              disabled={disabled}
            />
            <span className="absolute inset-0 rounded-full bg-zinc-700 transition peer-checked:bg-emerald-500" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </label>
        </div>

        {/* Custom list textarea */}
        <div className={`mt-3 ${overrideMonitored ? "opacity-100" : "opacity-60"}`}>
          <div className="flex items-center gap-1 text-xs font-medium text-zinc-300 mb-1">
            <span>Custom Tokens (one per line)</span>
            <StrategyTooltip name="monitoredTokens" />
          </div>
          <div className="relative rounded-md border border-zinc-800 bg-zinc-950/60">
            <textarea
              name="monitoredTokens"
              rows={4}
              value={monitoredTokens}
              onChange={onChangeTokens}
              onBlur={onBlurTokens}
              placeholder="Mint addresses…"
              className="w-full resize-y bg-transparent px-2 py-2 text-sm text-white placeholder:text-zinc-500 outline-none"
              disabled={disabled || !overrideMonitored}
            />
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[11px] text-zinc-400">
              When “Use My Token List” is enabled, the feed is ignored.
            </p>
            <p className="text-[11px] text-zinc-400">
              {overrideMonitored
                ? `Detected: ${tokenCount} token${tokenCount === 1 ? "" : "s"}`
                : "—"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
