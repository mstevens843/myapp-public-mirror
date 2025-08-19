// SafetyToggleRow.jsx
import { useState, useMemo } from "react";
import { Settings2 } from "lucide-react";
import SafetyChecksModal, { RULES } from "./Modals/SafetyChecksModal";
import { Switch } from "@/components/ui/switch"; // your toggle

// Lightweight tooltip wrapper using Tailwind group-hover
function HoverTip({ tip, children, side = "top" }) {
  const pos =
    side === "top"
      ? "left-1/2 top-0 -translate-x-1/2 -translate-y-[110%]"
      : "left-1/2 bottom-0 -translate-x-1/2 translate-y-[110%]";
  return (
    <div className="relative inline-flex items-center group">
      {children}
      <div
        className={`pointer-events-none absolute z-40 hidden w-max
                    rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs
                    text-white shadow-lg group-hover:block ${pos}`}
      >
        {tip}
      </div>
    </div>
  );
}

export default function SafetyToggleRow({ cfg, onChange }) {
  const [open, setOpen] = useState(false);

  const enabled = cfg?.safetyEnabled !== false; // default true
  const checks  = cfg?.safetyChecks || {};

  const passed = useMemo(
    () => Object.values(checks).filter(Boolean).length,
    [checks]
  );
  const total = RULES.length;

  const openIfEnabled = () => enabled && setOpen(true);

  return (
    <>
      <div className="flex items-center justify-between gap-2 mt-4">
        <div className="text-sm font-medium text-white flex items-center gap-2">
          {/* Label: highlight on hover (no underline), opens modal */}
          <HoverTip tip="Click to view/adjust checks">
            <span
              role="button"
              tabIndex={0}
              onClick={openIfEnabled}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && openIfEnabled()
              }
              className={
                enabled
                  ? "cursor-pointer hover:text-emerald-300"
                  : "text-zinc-500 cursor-not-allowed"
              }
            >
              Safety Checks
            </span>
          </HoverTip>

          {/* Gear icon (unchanged) */}
          <button
            onClick={() => setOpen(true)}
            disabled={!enabled}
            className="hover:text-purple-400 disabled:text-zinc-600"
            title="Click to view/adjust checks"
          >
            <Settings2 size={16} />
          </button>
        </div>

        {/* Switch with auto-open on enable + tooltip */}
        <HoverTip
          tip={
            enabled
              ? "Disable safety checks"
              : "Enable safety checks (opens settings)"
          }
        >
          <div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                onChange({
                  safetyEnabled: v,
                  // when re-enabled, default all flags true
                  safetyChecks: v
                    ? {
                        simulation: true,
                        liquidity: true,
                        authority: true,
                        topHolders: true,
                      }
                    : {},
                });
                if (v) setOpen(true); // auto-open modal when toggled ON
              }}
            />
          </div>
        </HoverTip>
      </div>

      {enabled && (
        // Status line: highlight on hover (no underline), opens modal
        <HoverTip tip="Click to view/adjust checks">
          <p
            role="button"
            tabIndex={0}
            onClick={openIfEnabled}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && openIfEnabled()
            }
            className="text-xs text-zinc-400 mt-1 cursor-pointer hover:text-emerald-300"
          >
            {passed}/{total} checks active
          </p>
        </HoverTip>
      )}

      <SafetyChecksModal
        open={open}
        onClose={() => setOpen(false)}
        checks={checks}
        onSave={(newChecks) => onChange({ safetyChecks: newChecks })}
      />
    </>
  );
}
