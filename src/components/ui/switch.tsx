"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => {
  return (
    <SwitchPrimitives.Root
      ref={ref}
      className={cn(
        "peer relative inline-flex h-[28px] w-[50px] shrink-0 cursor-pointer items-center rounded-full",
        "bg-muted transition-colors duration-300 ease-in-out",
        "data-[state=checked]:bg-[#34C759]", // iOS green
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-[24px] w-[24px] rounded-full bg-background shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
          "transition-transform duration-300 ease-in-out",
          "translate-x-[2px] data-[state=checked]:translate-x-[24px]"
        )}
      />
    </SwitchPrimitives.Root>
  )
})

Switch.displayName = SwitchPrimitives.Root.displayName
export { Switch }
