"use client";

import { cn } from "@/lib/utils";

export type RadioChipItem<T extends string> = {
  value: T;
  label: string;
  description?: string;
  accent?: string;
};

export function RadioChips<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  className
}: {
  items: RadioChipItem<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => {
        const active = item.value === value;
        const accent = item.accent;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            title={item.description}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border transition-[background-color,border-color,color,box-shadow,transform] [transition-duration:var(--motion-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.98] motion-reduce:transform-none",
              // 墨案 05 页选择胶囊：未选白底细边，选中 teal-soft + 墨点
              size === "sm" ? "h-[26px] px-2.5 text-[11.5px]" : "h-[32px] px-3.5 text-[13px]",
              active
                ? "border-[var(--teal-line)] bg-[var(--teal-soft)] font-[600] text-[var(--teal-deep)]"
                : "border-[var(--bd-default)] bg-card text-[var(--t-secondary)] hover:border-[var(--bd-strong)] hover:bg-[var(--bg-hover)] hover:text-foreground"
            )}
            style={
              active && accent
                ? { borderColor: `${accent}AA`, background: `${accent}1A`, color: accent }
                : undefined
            }
          >
            {active && (
              <span
                className="h-[5px] w-[5px] rounded-full bg-current"
                style={accent ? { background: accent } : undefined}
                aria-hidden
              />
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
