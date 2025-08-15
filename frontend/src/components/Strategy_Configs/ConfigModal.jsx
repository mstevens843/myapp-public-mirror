import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserProvider";

export default function ConfigModal({
  open,
  onClose,
  onSave,
  strategy = "Strategy",
  config,
  setConfig,
  children,
  disabled = false,
}) {
  const [tempConfig, setTempConfig] = useState(config);
  const { activeWallet } = useUser();

  useEffect(() => {
    if (open) {
      setTempConfig((prev) => ({
        ...config,
        walletId: config.walletId ?? activeWallet?.id,
      }));
    }
  }, [open, config, activeWallet]);

  const handleSave = () => onSave?.(tempConfig);
  const handleCancel = () => onClose?.();

  // Width rules:
  const isTurboSniper =
    typeof strategy === "string" && /turbo\s*sniper/i.test(strategy);
  const widthClasses = isTurboSniper
    ? "w-[880px] max-w-[96vw]"
    : "w-[660px] max-w-[94vw]";

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <Dialog.Portal>
        {/* Darker, less see-through background */}
        <Dialog.Overlay className="fixed inset-0 bg-black/85 backdrop-blur-sm z-40 data-[state=open]:animate-fadeIn" />

        <Dialog.Content
          className={`fixed top-1/2 left-1/2 z-50 ${widthClasses} -translate-x-1/2 -translate-y-1/2
                      rounded-2xl border border-zinc-700 bg-zinc-1000/95 p-6 shadow-2xl
                      data-[state=open]:animate-scaleIn transition-all`}
        >
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <Dialog.Title className="text-lg font-bold text-white tracking-wide">
              {strategy} Config
            </Dialog.Title>
            <button
              onClick={handleCancel}
              className="text-zinc-400 hover:text-white transition"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 mb-4 overscroll-contain">
            {React.cloneElement(children, {
              config: tempConfig,
              setConfig: setTempConfig,
              disabled,
            })}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800 mt-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-md bg-zinc-700 hover:bg-zinc-600 text-white text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-md text-black text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
            >
              Save &amp; Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
