"use client";

/**
 * 墨案 03 页筛选按钮（.filter-btn）：未选时「标签 ⌄」，选中后 teal 底「标签 值 ×」。
 * 值为 undefined/空串表示未筛选；清除按钮与菜单内「全部」等价。
 */
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "全部",
  clearable = true,
  icon
}: {
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
  /** 不可清空的筛选（如「范围」「排序」）始终显示当前值、不显示 × */
  clearable?: boolean;
  icon?: React.ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  const on = clearable && Boolean(current);
  return (
    <span className={cn("mo-filter-btn p-0", on && "on")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-full items-center gap-1.5 bg-transparent px-[11px] font-[inherit] text-inherit outline-none">
            {icon}
            {label}
            {current ? <span className="fv">{current.label}</span> : null}
            {!on ? <ChevronDown aria-hidden /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-[10rem] overflow-y-auto">
          {clearable ? (
            <DropdownMenuItem onSelect={() => onChange(undefined)} className={cn(!current && "font-semibold text-[var(--teal-deep)]")}>
              {allLabel}
            </DropdownMenuItem>
          ) : null}
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onSelect={() => onChange(o.value)}
              className={cn(o.value === value && "font-semibold text-[var(--teal-deep)]")}
            >
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {on ? (
        <button type="button" aria-label={`清除${label}筛选`} onClick={() => onChange(undefined)} className="x -ml-1 pr-[10px]">
          ×
        </button>
      ) : null}
    </span>
  );
}
