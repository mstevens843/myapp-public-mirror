import { useState } from "react";
import { Settings2 } from "lucide-react";
import SafetyChecksModal, { RULES }  from "./Modals/SafetyChecksModal";
import { Switch } from "@/components/ui/switch"; // your toggle

export default function SafetyToggleRow({ cfg, onChange }) {
  const [open, setOpen] = useState(false);

  const enabled = cfg.safetyEnabled !== false;   // default true
  const checks  = cfg.safetyChecks || {};

  const passed  = Object.values(checks).filter(Boolean).length;
  const total   = RULES.length

  return (
    <>
      <div className="flex items-center justify-between gap-2 mt-4">
        <div className="text-sm font-medium text-white flex items-center gap-2">
          Safety Checks
          <button
            onClick={() => setOpen(true)}
            disabled={!enabled}
            className="hover:text-purple-400 disabled:text-zinc-600"
            title="Configure safety checks"
          >
            <Settings2 size={16} />
          </button>
        </div>

        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange({
            safetyEnabled: v,
            // if they re-enable, default all flags true
            safetyChecks : v ? { simulation:true, liquidity:true, authority:true, topHolders:true } : {}
          })}
        />
      </div>

      {enabled && (
        <p className="text-xs text-zinc-400 mt-1">
          {passed}/{total} checks active
        </p>
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
