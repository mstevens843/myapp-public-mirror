import * as Dialog from "@radix-ui/react-dialog";
import { X, CheckCircle, AlertTriangle } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner"; 
import StrategyConfigLoader from "./StrategyConfigLoader";
import * as Tabs from "@radix-ui/react-tabs";

/* 1️⃣ Strategies that need NO extra inputs */
const CONFIG_OPTIONAL = ["scalper", "sniper"];
const BASE_FIELDS = ["slippage", "interval", "maxTrades", "amountToSpend"];


/* 2️⃣ How many inputs each strategy must have filled */
const REQUIRED_FIELD_COUNT = {
  dipBuyer: 2,
  trendFollower: 2,
  breakout: 3,
  chadMode: 2,
  delayedSniper: 1,
  rebalancer: 2,
  rotationBot: 2,
};

export default function MultiStrategyConfigModal({
  open,
  onClose,
  onSave,
  selectedStrategies,
  multiConfigs,
  setMultiConfigs,
  disabled,
}) {
  const [tempConfigs, setTempConfigs] = useState({});

  /* Sync on open */
  useEffect(() => {
    if (open) {
      const initial = {};
      selectedStrategies.forEach((s) => (initial[s] = multiConfigs[s] || {}));
      setTempConfigs(initial);
    }
  }, [open, selectedStrategies, multiConfigs]);

  /* -------- validation helpers -------- */
  const isConfigValid = (strat) => {
  if (CONFIG_OPTIONAL.includes(strat)) return true;

  const cfg = tempConfigs[strat] || {};

  // Only count extra fields (not the shared base ones)
  const filled = Object.entries(cfg).filter(
    ([key, value]) =>
      !BASE_FIELDS.includes(key) &&
      value !== "" &&
      value !== null &&
      value !== undefined
  ).length;

  const required = REQUIRED_FIELD_COUNT[strat] ?? 1;
  return filled >= required;
};


  const hasMissingFields = selectedStrategies.some((s) => !isConfigValid(s));

  /* -------- handlers -------- */
  const handleSave = () => {
  setMultiConfigs(tempConfigs);
  onSave?.();
};

  /* -------- render -------- */
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[90vw] max-w-2xl z-50 shadow-lg space-y-6 overflow-y-auto max-h-[80vh]">
          {/* header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">⚙️ Multi-Strategy Config</h2>
            <X onClick={onClose} className="w-5 h-5 text-zinc-400 hover:text-red-400 cursor-pointer" />
          </div>

          {/* no strategies */}
          {selectedStrategies.length === 0 && (
            <p className="text-sm text-zinc-400 italic">No strategies selected yet.</p>
          )}

          {/* tabs */}
          {selectedStrategies.length > 0 && (
            <Tabs.Root defaultValue={selectedStrategies[0]} className="w-full">
              <Tabs.List className="flex flex-wrap gap-2 border-b border-zinc-700 mb-4">
                {selectedStrategies.map((s) => {
                  const valid = isConfigValid(s);
                  return (
                    <Tabs.Trigger
                      key={s}
                      value={s}
                      className={`px-3 py-1 text-sm rounded-t-md border border-zinc-700 border-b-0 flex items-center gap-1 ${
                        valid ? "text-emerald-400 hover:bg-zinc-800" : "text-red-400 hover:bg-zinc-800"
                      }`}
                    >
                      {s.replace(/([A-Z])/g, " $1")}
                      {valid ? (
                        <CheckCircle size={14} className="text-emerald-400" />
                      ) : (
                        <AlertTriangle size={14} className="text-yellow-400" />
                      )}
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>

              {/* tab panels */}
              {selectedStrategies.map((s) => {
                const localCfg = tempConfigs[s] || {};
                const updateCfg = (upd) =>
                  setTempConfigs((prev) => ({
                    ...prev,
                    [s]:
                      typeof upd === "function" ? upd(prev[s] || {}) : { ...(prev[s] || {}), ...upd },
                  }));

                return (
                  <Tabs.Content key={s} value={s} className="space-y-4">
                    <StrategyConfigLoader strategy={s} config={localCfg} setConfig={updateCfg} disabled={disabled} />
                  </Tabs.Content>
                );
              })}
            </Tabs.Root>
          )}

          {/* footer actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-zinc-700 text-white rounded hover:bg-zinc-600">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm rounded text-white font-semibold bg-emerald-600 hover:bg-emerald-700"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
