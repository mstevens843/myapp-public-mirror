import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useUser } from "@/contexts/UserProvider";

export default function ConfigModal({
  open,
  onClose,
  onSave,
  strategy = "Strategy",
  config,
  setConfig,         // forwarded to children via clone
  children,
  disabled = false,
}) {
  const [tempConfig, setTempConfig] = useState(config);
  const { activeWallet } = useUser();
  const contentRef = useRef(null);

  // Keep a working copy while open
  useEffect(() => {
    if (open) {
      setTempConfig({
        ...config,
        walletId: config?.walletId ?? activeWallet?.id,
      });
    }
    // NOTE: intentionally *not* depending on tempConfig here
  }, [open, config, activeWallet]);

  const handleSave = () => onSave?.(tempConfig);
  const handleCancel = () => onClose?.();

  const isTurboSniper =
    typeof strategy === "string" && /turbo\s*sniper/i.test(strategy);
  const widthClasses = isTurboSniper
    ? "w-[880px] max-w-[96vw]"
    : "w-[660px] max-w-[94vw]";

  // Inner Save Preset mini-modal flag: when up, block close behaviors
  const suppressClose = () => document?.body?.dataset?.saveOpen === "1";

  // Treat any of these as "inside" for Radix outside detection
  const isInsideDialogish = (target) => {
    if (!target) return false;
    const sel = [
      "[data-inside-dialog]",
      "[data-radix-popper-content]", // Radix popovers/menus
      "[role='dialog']",
    ].join(",");
    return !!(
      target.closest?.(sel) ||
      contentRef.current?.contains?.(target)
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (suppressClose()) return; // block close while mini-modal is up
          onClose?.();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/85 backdrop-blur-sm z-40 data-[state=open]:animate-fadeIn" />

        {/* Use asChild so we control the focusable element */}
        <Dialog.Content
          asChild
          onOpenAutoFocus={(e) => e.preventDefault()} // stop refocus stealing
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (suppressClose()) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            const t = e?.target;
            if (suppressClose() || isInsideDialogish(t)) {
              e.preventDefault(); // don't let Radix close
            }
          }}
          onInteractOutside={(e) => {
            const t = e?.target;
            if (suppressClose() || isInsideDialogish(t)) {
              e.preventDefault(); // don't let Radix close
            }
          }}
          // (optional) helps when nested popovers move focus
          onFocusCapture={() => {
            // no-op; ensures content stays mounted while focus moves
          }}
        >
          <div
            ref={contentRef}
            className={`fixed top-1/2 left-1/2 z-50 ${widthClasses}
                        -translate-x-1/2 -translate-y-1/2 rounded-2xl
                        border border-zinc-700 bg-zinc-1000/95 p-6 shadow-2xl
                        data-[state=open]:animate-scaleIn transition-all
                        focus:outline-none focus-visible:outline-none ring-0`}
            data-inside-dialog="1"
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
            <div
              className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 mb-4 overscroll-contain"
              data-inside-dialog="1"
            >
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
