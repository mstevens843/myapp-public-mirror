import { useEffect } from "react";
import { ShieldOff, X } from "lucide-react";

export default function ArmEndModal({
  open,
  autoReturn = false,
  onClose,
  onReArm,
}) {
  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm opacity-100 transition-opacity duration-300"
      />
      {/* Modal */}
      <div className="absolute left-1/2 top-1/2 w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 transform opacity-100 scale-100 transition-all duration-300">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/25 shadow-[0_0_40px_-10px_rgba(16,185,129,0.6)]">
          {/* Glow layers */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-fuchsia-500/10 to-cyan-500/20 blur-2xl" />
          <div className="relative z-10 bg-zinc-900/85">
            {/* Top bar accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-fuchsia-400 to-cyan-400" />

            {/* Header */}
            <div className="flex items-start gap-4 p-6">
              <div className="shrink-0 grid place-items-center w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-400/30 shadow-[0_0_20px_-6px_rgba(16,185,129,0.6)]">
                <ShieldOff className="text-emerald-300" size={24} />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold tracking-tight">
                  Wallet arm session ended
                </h2>
                <p className="mt-1 text-sm text-zinc-300">
                  Please re-enable in your <span className="font-semibold text-white">Account</span> tab to continue trading.
                </p>
                {autoReturn ? (
                  <div className="mt-3 text-sm rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
                    <span className="font-medium text-emerald-300">Auto-send triggered.</span>{" "}
                    Funds sent back to your designated wallet.
                  </div>
                ) : null}
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/5 text-zinc-300 hover:text-white transition"
                aria-label="Close"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Actions */}
            <div className="px-6 pb-6">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={onReArm}
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-900 bg-gradient-to-r from-emerald-300 via-fuchsia-300 to-cyan-300 hover:from-emerald-200 hover:via-fuchsia-200 hover:to-cyan-200 shadow-[0_8px_30px_rgb(16,185,129,0.25)]"
                >
                  Re-Arm Now
                </button>
                <button
                  onClick={onClose}
                  className="ml-auto inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-200 hover:text-white hover:bg-white/5 border border-white/10"
                >
                  Dismiss
                </button>
              </div>

              {/* Subtle footer hint */}
              <div className="mt-4 text-[12px] text-zinc-400">
                Tip: Set default Arm duration and Auto-send in <span className="text-zinc-300">Account → Security</span>.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
