// components/ui/slider.jsx

import * as SliderPrimitive from "@radix-ui/react-slider";
import clsx from "clsx";

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value = [0],
  onValueChange,
  className = "",
}) {
  return (
<SliderPrimitive.Root
  className={clsx(
    "relative flex w-full touch-none select-none items-center text-green-500", // ← add this
    className
  )}
      min={min}
      max={max}
      step={step}
      value={value}
      onValueChange={onValueChange}
    >
      {/* Track background */}
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-zinc-700">
        {/* Filled part of the slider */}
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-green-500 !important" />

      </SliderPrimitive.Track>

      {/* Thumb knob */}
      <SliderPrimitive.Thumb
        className="block h-4 w-4 rounded-full border-2 border-white bg-zinc-300 shadow transition-colors duration-150 hover:bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </SliderPrimitive.Root>
  );
}
