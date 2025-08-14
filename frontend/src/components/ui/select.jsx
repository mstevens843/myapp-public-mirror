import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

function cn(...cls) {
  return cls.filter(Boolean).join(" ");
}

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef(function SelectTrigger(
  { className, children, ...props },
  ref
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "w-full inline-flex items-center justify-between rounded-md px-3 py-2",
        "bg-zinc-900 text-white border border-zinc-700",
        "shadow-sm outline-none ring-0 focus:border-emerald-600",
        "data-[state=open]:border-emerald-600",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef(function SelectContent(
  { className, children, position = "popper", ...props },
  ref
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-md border",
          "bg-zinc-900 text-white border-zinc-700 shadow-2xl",
          "animate-in fade-in-0 zoom-in-95",
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

function SelectScrollUpButton() {
  return (
    <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-zinc-400">
      <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton() {
  return (
    <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-zinc-400">
      <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export const SelectLabel = ({ className, ...props }) => (
  <SelectPrimitive.Label className={cn("px-2 py-1.5 text-xs text-zinc-400", className)} {...props} />
);

export const SelectSeparator = ({ className, ...props }) => (
  <SelectPrimitive.Separator className={cn("mx-2 my-1 h-px bg-zinc-800", className)} {...props} />
);

export const SelectItem = React.forwardRef(function SelectItem(
  { className, children, ...props },
  ref
) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none",
        "text-zinc-200",
        "data-[highlighted]:bg-emerald-900/30 data-[highlighted]:text-white",
        "data-[state=checked]:text-emerald-300",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 inline-flex w-4 justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
