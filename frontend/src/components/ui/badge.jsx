import React from "react";
import { cn } from "@/lib/utils";

export function Badge({ children, variant = "default", className = "" }) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  const variants = {
    default: "bg-zinc-800 text-zinc-100 border border-zinc-600",
    secondary: "bg-zinc-700 text-zinc-300 border border-zinc-500",
    green: "bg-emerald-600 text-white",
    red: "bg-red-600 text-white",
    glow: "bg-zinc-900 border border-emerald-500 text-emerald-400 shadow shadow-emerald-500/20",
  };

  return (
    <span className={cn(base, variants[variant], className)}>
      {children}
    </span>
  );
}
