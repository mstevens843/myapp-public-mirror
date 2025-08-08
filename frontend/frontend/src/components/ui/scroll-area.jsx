import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import * as React from "react";
import { cn } from "@/lib/utils";

export const ScrollArea = ({ className, children, ...props }) => (
  <ScrollAreaPrimitive.Root
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      className="flex touch-none select-none p-[1px] bg-zinc-800 transition-colors duration-150 ease-out hover:bg-zinc-700"
    >
      <ScrollAreaPrimitive.Thumb className="rounded-full bg-zinc-500" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Scrollbar
      orientation="horizontal"
      className="flex touch-none select-none p-[1px] bg-zinc-800 transition-colors duration-150 ease-out hover:bg-zinc-700"
    >
      <ScrollAreaPrimitive.Thumb className="rounded-full bg-zinc-500" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner className="bg-zinc-800" />
  </ScrollAreaPrimitive.Root>
);
