import { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function AdvancedSection({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-zinc-700 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2
                   bg-zinc-800 text-xs font-semibold text-zinc-300"
      >
        {title}
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="p-3 bg-zinc-900 border-t border-zinc-700 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}