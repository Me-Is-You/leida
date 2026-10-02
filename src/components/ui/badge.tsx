import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
  {
    variants: {
      tone: {
        mute: "bg-raised text-muted",
        accent: "bg-accent/15 text-accent",
        live: "bg-live/15 text-live",
        real: "bg-accent/20 text-accent",
        warn: "bg-warn/15 text-warn",
        twin: "bg-raised text-faint",
      },
    },
    defaultVariants: { tone: "mute" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
