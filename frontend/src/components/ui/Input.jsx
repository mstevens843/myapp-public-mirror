/**
 * Dark-glow Input
 * ------------------------------------------------------------------
 * • Tailwind + Radix-friendly
 * • Built-in leading / trailing icons
 * • Cyan focus ring, red error state
 * • Matches the app’s ✨ black-glow aesthetic
 * ------------------------------------------------------------------
 */

import { forwardRef } from "react";
import clsx from "clsx";

const Input = forwardRef(
  (
    {
      className      = "",
      error          = false,
      leadingIcon    : LeadingIcon,  // optional left-side icon (lucide)
      trailingIcon   : TrailingIcon, // optional right-side icon
      disabled       = false,
      ...props
    },
    ref,
  ) => {
    return (
      <div className={clsx("relative group", className)}>
        {/* leading icon */}
        {LeadingIcon && (
          <LeadingIcon
            size={14}
            className={clsx(
              "absolute left-3 top-1/2 -translate-y-1/2",
              disabled
                ? "text-zinc-600"
                : "text-zinc-500 group-focus-within:text-cyan-400",
            )}
          />
        )}

        {/* input */}
        <input
          ref={ref}
          disabled={disabled}
          {...props}
          className={clsx(
            "w-full rounded-lg bg-zinc-800",
            "border text-sm text-zinc-200 placeholder-zinc-500",
            "py-2 pr-3",
            LeadingIcon ? "pl-9" : "pl-3",
            disabled
              ? "border-zinc-700 opacity-60 cursor-not-allowed"
              : error
              ? "border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              : "border-zinc-700 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30",
            "transition-colors duration-150",
          )}
        />

        {/* trailing icon */}
        {TrailingIcon && (
          <TrailingIcon
            size={14}
            className={clsx(
              "absolute right-3 top-1/2 -translate-y-1/2",
              disabled
                ? "text-zinc-600"
                : "text-zinc-500 group-focus-within:text-cyan-400",
            )}
          />
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

export default Input;
