"use client";

/**
 * 单选字段：选项 ≤ threshold（默认 5）平铺为 chip，一眼可选；超过则收为下拉，避免一屏被按钮占满。
 * chip 样式沿用所在作用域的 `.chip-set / .chip`（墨案 05 收案抽屉）。
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ChoiceOption<V extends string> = { value: V; label: string };

export function ChoiceField<V extends string>({
  options,
  value,
  onChange,
  placeholder = "请选择",
  threshold = 5,
  disabled,
  invalid,
  className,
  ariaLabel
}: {
  options: ChoiceOption<V>[];
  value: V | undefined | null;
  onChange: (value: V) => void;
  placeholder?: string;
  threshold?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  if (options.length <= threshold) {
    return (
      <div className={cn("chip-set", className)} role="radiogroup" aria-label={ariaLabel}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn("chip", value === o.value && "active")}
          >
            {value === o.value ? <span className="cd" /> : null}
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as V)} disabled={disabled}>
      <SelectTrigger className={cn("h-9", invalid && "!border-[var(--red)]", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
