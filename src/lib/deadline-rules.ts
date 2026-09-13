/**
 * v0.49 法定期限计算（PRD §二十）。
 *
 * 期间计算依据《中华人民共和国民事诉讼法（2023修正）》第八十五条（已核验）：
 * - 期间以时、日、月、年计算；期间开始的时和日不计算在期间内
 *   → 按日的期限：到期日 = 触发日 + N 日（即从次日起算第 N 日）
 * - 期间届满的最后一日是法定休假日的，以其后第一日为届满日
 *   → 系统不内置节假日表（每年国务院调整），由 UI 提示人工核对顺延
 * 按月/年的期间取到期月对应日；到期月无对应日的取该月最后一日。
 */
import type { DeadlinePeriodUnit } from "@prisma/client";

export const HOLIDAY_NOTE = "如届满日为法定休假日，以其后第一个工作日为届满日，请人工核对顺延";

/** 去掉时间部分，按本地日期归一到当天 00:00 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const out = startOfDay(date);
  out.setDate(out.getDate() + days);
  return out;
}

/** 到期月对应日；无对应日（如 1/31 + 1 月）取到期月最后一日 */
function addMonthsClamped(date: Date, months: number): Date {
  const base = startOfDay(date);
  const targetMonthFirst = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDayOfTargetMonth = new Date(
    targetMonthFirst.getFullYear(),
    targetMonthFirst.getMonth() + 1,
    0
  ).getDate();
  return new Date(
    targetMonthFirst.getFullYear(),
    targetMonthFirst.getMonth(),
    Math.min(base.getDate(), lastDayOfTargetMonth)
  );
}

export function computeDeadlineDate(
  triggerDate: Date,
  periodValue: number,
  periodUnit: DeadlinePeriodUnit
): Date {
  if (!Number.isInteger(periodValue) || periodValue <= 0) {
    throw new Error("期限数值必须为正整数");
  }
  switch (periodUnit) {
    case "DAYS":
      return addDays(triggerDate, periodValue);
    case "MONTHS":
      return addMonthsClamped(triggerDate, periodValue);
    case "YEARS":
      return addMonthsClamped(triggerDate, periodValue * 12);
  }
}

export function periodLabel(periodValue: number, periodUnit: DeadlinePeriodUnit): string {
  const unit = periodUnit === "DAYS" ? "日" : periodUnit === "MONTHS" ? "个月" : "年";
  return `${periodValue} ${unit}`;
}

/** 本地时区 yyyy-MM-dd。不能用 toISOString（UTC+8 下会把本地日期偏移一天） */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 生成 Deadline.basis 文本：法条 + 计算过程 + 顺延提示 */
export function buildDeadlineBasis(input: {
  legalBasis: string;
  triggerLabel: string;
  triggerDate: Date;
  periodValue: number;
  periodUnit: DeadlinePeriodUnit;
}): string {
  return [
    input.legalBasis,
    `自${input.triggerLabel}（${formatLocalDate(input.triggerDate)}）起 ${periodLabel(input.periodValue, input.periodUnit)}`,
    HOLIDAY_NOTE
  ].join("；");
}
