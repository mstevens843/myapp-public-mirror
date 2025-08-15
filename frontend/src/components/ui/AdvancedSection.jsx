// AdvancedSection.jsx — Turbo-style collapsible card (open by default)
import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Props:
 * - title: string
 * - className?: string
 * - defaultOpen?: boolean (default: true)
 * - open?: boolean            // optional controlled state
 * - onOpenChange?: (bool) => void
 */
export default function AdvancedSection({
  title,
  children,
  className = "",
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const panelId = useId();
  const headerId = `${panelId}-header`;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden ${className}`}>
      <button
        id={headerId}
        onClick={toggle}
        aria-controls={panelId}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 sm:px-4 py-2.5
                   text-xs sm:text-sm font-semibold text-zinc-200
                   bg-zinc-1000 hover:bg-zinc-900 transition"
      >
        {title}
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="p-3 sm:p-4 bg-zinc-900/40 border-t border-zinc-800"
        >
          {children}
        </div>
      )}
    </div>
  );
}
