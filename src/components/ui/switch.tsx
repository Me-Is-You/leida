import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-raised shadow-[var(--shadow-border)] transition-colors duration-150 data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-fg transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-bg" />
    </SwitchPrimitive.Root>
  );
}
