"use client";

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  className,
  maxChips = 6,
  placeholder = "请选择"
}: {
  items: RadioChipItem<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** 选项超过该数量时收为下拉，避免一屏被胶囊占满（审查 2026-09-14） */
  maxChips?: number;
  placeholder?: string;
}) {
  if (items.length > maxChips) {
    return (
      <Select value={value ?? ""} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className={cn(size === "sm" ? "h-8 text-[12px]" : "h-9", className)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
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
