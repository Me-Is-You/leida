import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
  {
    variants: {
      variant: {
        default: "bg-fg text-bg hover:bg-fg/90",
        accent: "bg-accent text-bg hover:bg-accent/90",
        outline: "bg-transparent text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)] hover:bg-raised",
        ghost: "bg-transparent text-muted hover:text-fg hover:bg-raised",
        danger: "bg-alert/15 text-alert hover:bg-alert/25",
      },
      size: {
        default: "h-10 px-3.5",
        sm: "h-8 px-2.5 text-xs rounded-xs",
        lg: "h-11 px-4",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  noScale?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, noScale, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), !noScale && "active:not-disabled:scale-[0.96]", className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
