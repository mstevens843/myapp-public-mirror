import React from "react";

/**
 * StrategyRail – Categorized rail with titanium aesthetic.
 * - Single-mode: click = select; clicking the selected item opens config modal.
 * - Multi-mode: click toggles. Selected items show ✓.
 * - Selected single-mode item shows a second line: “X/Y required fields set”.
 */

const StrategyRail = ({
  multiModeEnabled,
  enabledStrategies,
  toggleStrategy,
  railSelection,
  setRailSelection,
  setSelectedMode,
  onScheduleClick,
  requiredFieldStatus,
  selectedMode,
  selectedOptionLabel,
  onOpenConfig,
}) => {
  const EXECUTION_OPTIONS = [
    { value: "sniper", label: "🔫 Sniper" },
    { value: "scalper", label: "⚡ Scalper" },
    { value: "breakout", label: "🚀 Breakout" },
    { value: "dipBuyer", label: "💧 Dip Buyer" },
    { value: "chadMode", label: "🔥 Chad" },
    { value: "delayedSniper", label: "⏱️ Delayed" },
    { value: "trendFollower", label: "📈 Trend" },
  ];

  // Turbo section (single strategy)
  const TURBO_OPTIONS = [
    { value: "turboSniper", label: "💨 Turbo Sniper" },
  ];

  const UTILITY_OPTIONS = [
    { value: "rebalancer", label: "⚖️ Rebalancer" },
    { value: "rotationBot", label: "🔁 Rotation" },
    { value: "stealthBot", label: "🥷 Stealth" },
    { value: "schedule", label: "🕒 Schedule" },
  ];

  const isActive = (value) =>
    multiModeEnabled ? enabledStrategies.includes(value) : railSelection === value;

const handleClick = (opt) => {
  if (opt.value === "schedule") {
    onScheduleClick?.();
    return;
  }

  if (multiModeEnabled) {
    // multi-mode: toggle
    toggleStrategy(opt.value);
    return;
  }

  // ── single-mode ────────────────────────────────────────────────
  if (railSelection === opt.value) {
    // already selected → open config
    onOpenConfig?.();
  } else {
    // first click on a new item:
    // 1) select it
    setRailSelection(opt.value);
    setSelectedMode(opt.value);

    // 2) open modal right away on the next frame
    //    (ensures selectedMode is committed before modal reads it)
    if (onOpenConfig) {
      requestAnimationFrame(() => onOpenConfig());
      // or: setTimeout(onOpenConfig, 0);
    }
  }
};

  const baseButton =
    "w-full rounded-lg text-sm transition-colors duration-150 focus:outline-none border";
  const idleBtn =
    "bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-700/60 hover:text-white";
  const activeBtn =
    "bg-zinc-700/80 border-zinc-600 text-emerald-300 shadow-inner";

  const Group = ({ title, options, isUtility = false }) => (
    <div className="mb-4 last:mb-0">
      <h3 className="px-1 pb-1 text-xs uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      {options.map((opt) => {
        const active = isActive(opt.value);
        const isSchedule = opt.value === "schedule";
        const pressed = active && !multiModeEnabled;

        // Show required status if selected in single mode
        const showStatusLine =
          pressed && requiredFieldStatus && selectedMode === opt.value;

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt)}
            className={[
              baseButton,
              isSchedule ? idleBtn : active ? activeBtn : idleBtn,
              "px-3 py-2 mb-2 text-left",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <span
                className={[
                  "flex items-center gap-2 truncate",
                  pressed ? "font-semibold" : "",
                ].join(" ")}
              >
                {opt.label}
              </span>
              {multiModeEnabled && !isSchedule && active && (
                <span className="text-emerald-400">✔</span>
              )}
            </div>

            {/* 👇 Show required status under selected button */}
            {showStatusLine && (
              <div className="mt-1 text-[11px] leading-tight text-zinc-400">
                {requiredFieldStatus}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="w-60 md:w-64 flex-shrink-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-700 border border-zinc-700 rounded-xl shadow-inner p-3">
      <Group title="Execution" options={EXECUTION_OPTIONS} />
      <Group title="Utility" options={UTILITY_OPTIONS} isUtility />
      {/* New Turbo section */}
      <Group title="Turbo" options={TURBO_OPTIONS} />
    </div>
  );
};

export default StrategyRail;
