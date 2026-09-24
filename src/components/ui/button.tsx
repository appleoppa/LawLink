import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 墨案 .btn：34px / 8px 圆角 / 550 字重 / 15px 图标；按压 0.985
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-transparent text-[13px] font-[550] tracking-[-0.005em] ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(0,123,127,0.22)] motion-reduce:transform-none motion-reduce:transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[15px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // .btn-primary：teal 只给页面主操作
        default: "bg-[var(--teal)] text-white shadow-[0_1px_2px_rgba(0,80,84,0.25),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-[var(--teal-h)]",
        // 实心红：仅不可逆的删除确认
        destructive: "bg-[var(--red)] text-white shadow-[0_1px_2px_rgba(180,35,24,0.25)] hover:bg-[#941D14]",
        // .btn-danger：驳回/退回等风险操作（红框白底）
        danger: "border-[var(--red-line)] bg-card text-[var(--red)] hover:bg-[var(--red-bg)]",
        // .btn-secondary
        outline: "border-[var(--bd-default)] bg-card text-foreground shadow-[var(--sh-card)] hover:border-[var(--bd-strong)] hover:bg-[var(--bg-hover)]",
        secondary: "border-[var(--bd-default)] bg-card text-foreground shadow-[var(--sh-card)] hover:border-[var(--bd-strong)] hover:bg-[var(--bg-hover)]",
        // .btn-ghost
        ghost: "bg-transparent text-[var(--t-secondary)] hover:bg-[var(--bg-hover)] hover:text-foreground",
        // .btn-approve：审批通过等终局确认（案卷墨）
        approve: "bg-[var(--navy)] text-white shadow-[0_1px_2px_rgba(12,25,39,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-[#1A3350]",
        link: "h-auto px-0 text-[var(--teal)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[34px] px-[15px]",
        sm: "h-[29px] rounded-[7px] px-[11px] text-[12.5px] [&_svg]:size-[13.5px]",
        lg: "h-10 rounded-[9px] px-5 text-[14px]",
        icon: "h-[34px] w-[34px] px-0",
        "icon-sm": "h-[29px] w-[29px] rounded-[7px] px-0 [&_svg]:size-[13.5px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
