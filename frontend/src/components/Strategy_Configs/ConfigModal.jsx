// frontend/src/components/Strategy_Configs/ConfigModal.jsx
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useUser } from "@/contexts/UserProvider";

// Instrumentation helper (no-ops unless BREAKOUT_DEBUG=1 in localStorage)
import { logEffect } from "../../dev/inputDebug";

export default function ConfigModal({
  open,
  onClose,
  onSave,
  strategy = "Strategy",
  config,
  setConfig, // forwarded to children via clone
  children,
  disabled = false,
}) {
  const [tempConfig, setTempConfig] = useState(config);
  const { activeWallet } = useUser();
  const contentRef = useRef(null);

  // Helper to read the currently focused field name
  const getActiveField = () =>
    typeof window !== "undefined" ? window.__BREAKOUT_ACTIVE_FIELD : null;

  /**
   * safeSetTempConfig:
   * - Allows direct edits to the active field (keep the user's new value).
   * - If an incoming patch/effect tries to touch the active field while typing,
   *   preserve the previous value (guard against clobbering).
   */
  const safeSetTempConfig = useCallback(
    (value) => {
      const activeField = getActiveField();

      if (typeof value === "function") {
        setTempConfig((prev) => {
          const prevObj = prev ?? {};
          const nextObj = value(prevObj) ?? {};

          // Use the user-provided next object as the base
          const result = { ...nextObj };

          if (activeField) {
            const prevHas = Object.prototype.hasOwnProperty.call(prevObj, activeField);
            const nextHas = Object.prototype.hasOwnProperty.call(nextObj, activeField);
            const userEditedActive =
              nextHas && nextObj[activeField] !== prevObj[activeField];

            // If this update did NOT explicitly change the active field,
            // keep the previous active value to avoid clobbering in-progress typing.
            if (!userEditedActive && prevHas) {
              result[activeField] = prevObj[activeField];
            }
          }

          logEffect({
            comp: "ConfigModal",
            reason: "safeSetTempConfig(function)",
            touched: Object.keys(result),
          });
          return result;
        });
      } else {
        setTempConfig((prev) => {
          const prevObj = prev ?? {};
          const patch = value || {};

          // Merge patch with previous
          const result = { ...prevObj, ...patch };

          if (activeField) {
            const prevHas = Object.prototype.hasOwnProperty.call(prevObj, activeField);
            const patchTouches =
              Object.prototype.hasOwnProperty.call(patch, activeField) &&
              patch[activeField] !== prevObj[activeField];

            // If a non-user merge touches the active field, restore prev
            if (!patchTouches && prevHas) {
              result[activeField] = prevObj[activeField];
            }
          }

          logEffect({
            comp: "ConfigModal",
            reason: "safeSetTempConfig(object)",
            touched: Object.keys(result),
          });
          return result;
        });
      }
    },
    []
  );

  // Expose for console debugging
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__BREAKOUT_SAFE_SET = safeSetTempConfig;
    }
  }, [safeSetTempConfig]);

  // Keep a live mirror for console: window.__BREAKOUT_TEMP_CONFIG
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__BREAKOUT_TEMP_CONFIG = tempConfig;
    }
  }, [tempConfig]);

  // ---- initial sync: run ONCE per open, StrictMode-proof, never while typing
  const didInitialSyncRef = useRef(false);
  // StrictMode sentinel that survives remounts and strategy changes
  const SENTINEL_KEY = "__BREAKOUT_LAST_MODAL_SYNC__";
  const lastSyncRef = useRef(0); // also keep in-ref for non-window environments

  useEffect(() => {
    if (!open) {
      didInitialSyncRef.current = false;
      return;
    }
    if (didInitialSyncRef.current) return;

    // If already have a populated config, skip resync (prevents StrictMode double)
    if (tempConfig && Object.keys(tempConfig).length > 0) {
      logEffect({
        comp: "ConfigModal",
        reason: "skip sync (already populated)",
        touched: Object.keys(tempConfig),
      });
      didInitialSyncRef.current = true;
      return;
    }

    // If a field is active, delay sync
    if (getActiveField()) return;

    didInitialSyncRef.current = true; // set before mutating state

    setTempConfig(() => {
      const merged = {
        ...(config || {}),
        walletId: config?.walletId ?? activeWallet?.id,
      };
      logEffect({
        comp: "ConfigModal",
        reason: "sync on open (final guarded)",
        touched: Object.keys(merged),
      });
      return merged;
    });
  }, [open, activeWallet?.id, strategy]);

  // Keep walletId fresh while open (safe to update independently)
  useEffect(() => {
    if (!open) return;
    const id = activeWallet?.id;
    if (!id) return;
    setTempConfig((prev) => {
      const prevObj = prev ?? {};
      if (prevObj.walletId === id) return prevObj;
      const next = { ...prevObj, walletId: id };
      logEffect({
        comp: "ConfigModal",
        reason: "walletId sync",
        touched: ["walletId"],
      });
      return next;
    });
  }, [open, activeWallet?.id]);

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

  // --- HOTKEY / FOCUS STEAL GUARD -------------------------------
  const handleKeyCapture = useCallback((e) => {
    if (e.key === "Escape" && !suppressClose()) return;
    e.stopPropagation();
  }, []);
  // ---------------------------------------------------------------

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (suppressClose()) return;
          onClose?.();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/85 backdrop-blur-sm z-40 data-[state=open]:animate-fadeIn" />

        {/* NOTE: no `asChild` to avoid Radix "{undefined} for {DialogContent}" warning */}
        <Dialog.Content
          ref={contentRef}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (suppressClose()) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            const t = e?.target;
            if (suppressClose() || isInsideDialogish(t)) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const t = e?.target;
            if (suppressClose() || isInsideDialogish(t)) {
              e.preventDefault();
            }
          }}
          className={`fixed top-1/2 left-1/2 z-50 ${widthClasses}
            -translate-x-1/2 -translate-y-1/2 rounded-2xl
            border border-zinc-700 bg-zinc-1000/95 p-6 shadow-2xl
            data-[state=open]:animate-scaleIn transition-all
            focus:outline-none focus-visible:outline-none ring-0`}
          style={{ outline: "none", boxShadow: "none" }}
          data-inside-dialog="1"
          onKeyDownCapture={handleKeyCapture}
          onKeyUpCapture={(e) => e.stopPropagation()}
          onKeyPressCapture={(e) => e.stopPropagation()}
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
            onKeyDownCapture={handleKeyCapture}
            onKeyUpCapture={(e) => e.stopPropagation()}
            onKeyPressCapture={(e) => e.stopPropagation()}
          >
            {React.cloneElement(children, {
              config: tempConfig,
              setConfig: safeSetTempConfig,
              disabled,
            })}
          </div>

          {/* Footer */}
          <div
            className="flex justify-end gap-3 pt-4 border-t border-zinc-800 mt-2"
            data-inside-dialog="1"
            onKeyDownCapture={handleKeyCapture}
            onKeyUpCapture={(e) => e.stopPropagation()}
            onKeyPressCapture={(e) => e.stopPropagation()}
          >
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
