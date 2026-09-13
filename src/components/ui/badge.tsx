import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // 墨案 .badge：胶囊 + 同色细边，11px / 550
  "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-2 py-[2px] text-[11px] font-[550] leading-[1.65] tracking-[-0.005em]",
  {
    variants: {
      variant: {
        default: "border-[var(--teal-line)] bg-[var(--teal-soft)] text-[var(--teal-deep)]",
        teal: "border-[var(--teal-line)] bg-[var(--teal-soft)] text-[var(--teal-deep)]",
        secondary: "border-[var(--slate-line)] bg-[var(--slate-bg)] text-[var(--slate)]",
        slate: "border-[var(--slate-line)] bg-[var(--slate-bg)] text-[var(--slate)]",
        outline: "border-[var(--bd-subtle)] bg-card text-[var(--t-secondary)]",
        white: "border-[var(--bd-subtle)] bg-card text-[var(--t-secondary)]",
        destructive: "border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]",
        red: "border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]",
        "outline-red": "border-[var(--red-line)] bg-card text-[var(--red)]",
        green: "border-[var(--green-line)] bg-[var(--green-bg)] text-[var(--green)]",
        orange: "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]",
        amber: "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]",
        purple: "border-[var(--violet-line)] bg-[var(--violet-bg)] text-[var(--violet)]",
        violet: "border-[var(--violet-line)] bg-[var(--violet-bg)] text-[var(--violet)]",
        blue: "border-[var(--blue-line)] bg-[var(--blue-bg)] text-[var(--blue)]",
        bronze: "border-[var(--bronze-line)] bg-[var(--bronze-bg)] text-[var(--bronze)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
