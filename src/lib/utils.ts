import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { shDaysFromToday } from "@/lib/ui/sh-time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, options?: { compact?: boolean }) {
  if (options?.compact && Math.abs(amount) >= 10000) {
    return `¥${(amount / 10000).toFixed(1)}万`;
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(date: Date | string, fmt: "full" | "short" | "month-day" = "short") {
  const d = typeof date === "string" ? new Date(date) : date;
  if (fmt === "full") {
    return d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });
  }
  if (fmt === "month-day") {
    return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  }
  // 系统统一日期格式 YYYY-MM-DD（上海时区），避免 2026/9/6 与 2026-09-06 混用
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 系统统一日期时间格式 YYYY-MM-DD HH:mm（上海时区） */
export function formatDateTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false }).slice(0, 16);
}

/** 距上海「今天」的日历天数（不修改入参；与服务器/浏览器所在时区无关） */
export function daysUntil(date: Date | string): number {
  return shDaysFromToday(date);
}
