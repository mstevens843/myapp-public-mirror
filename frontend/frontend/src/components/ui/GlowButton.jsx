// src/components/ui/GlowButton.jsx
import React from "react";
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
export default function GlowButton({
  children,
  className = "",
  onClick,
  disabled = false,
  type = "button",
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        `relative inline-flex items-center justify-center px-4 py-2 rounded-xl font-semibold 
         text-white bg-zinc-900 border border-zinc-700 shadow-inner
         transition-all duration-300 hover:shadow-[0_0_12px_#10b98188]
         hover:border-emerald-500 hover:text-emerald-400
         disabled:opacity-40 disabled:cursor-not-allowed`,
        className
      )}
    >
      {children}
    </button>
  );
}
