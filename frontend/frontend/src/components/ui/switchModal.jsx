import * as SwitchPrimitive from "@radix-ui/react-switch";
import clsx from "clsx";

export function Switch({ checked, onCheckedChange, className = "" }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={clsx(
        "relative h-5 w-10 shrink-0 cursor-pointer rounded-full bg-zinc-700 " +
          "data-[state=checked]:bg-green-500 transition-colors",
        className
      )}
    >
      <SwitchPrimitive.Thumb
        className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[12px]"
      />
    </SwitchPrimitive.Root>
  );
}