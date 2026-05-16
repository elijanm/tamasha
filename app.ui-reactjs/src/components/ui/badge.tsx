import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-mono font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-violet-500/20 text-violet-400 border border-violet-500/30",
        secondary: "bg-stone-800 text-stone-400 border border-stone-700",
        destructive: "bg-red-500/20 text-red-400 border border-red-500/30",
        success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
        warning: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
        info: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
        outline: "border border-stone-700 text-stone-400",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
