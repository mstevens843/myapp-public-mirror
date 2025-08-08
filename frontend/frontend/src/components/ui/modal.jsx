import React from "react";
import { X } from "lucide-react";

/**
 * Simple centred modal (no Radix required)
 * Props:
 *  • open        – boolean
 *  • onClose()   – callback
 *  • title       – string (optional)
 *  • children    – modal body
 */
export default function Modal({ open, onClose, title, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg p-6 relative shadow-xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-400 hover:text-red-400 transition"
        >
          <X size={20} />
        </button>

        {title && (
          <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        )}

        {children}
      </div>
    </div>
  );
}
