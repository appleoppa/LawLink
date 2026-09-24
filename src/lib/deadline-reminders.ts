/**
 * 期限到期提醒的偏移规则（与 src/server/cron/jobs/scan-due-reminders.ts 配套）。
 *
 * 背景：扫描作业此前只按固定偏移 [-3, -1, 0, +1] 提醒，Deadline.remindDays
 * （逐条配置的"提前提醒天数"，默认 3，写入侧 Zod 校验 0..60 整数）一直只写不读。
 * 现约定：对每个在办期限，有效提前提醒偏移 = 固定提前档 {-3, -1} 与
 * {-remindDays} 的并集去重；到期当天（0）与逾期 1 天（+1）不随配置变化、
 * 始终提醒。
 *
 * remindDays 为默认值 3 时，-3 已包含在固定提前档内，行为与历史版本完全一致；
 * 只有把 remindDays 改成 1、2、4…60 等其他值时才会多出 / 变化提前档。
 */

/** 固定提前提醒档：提前 3 天 / 提前 1 天（v0.27 起的既有设计） */
export const DEADLINE_FIXED_ADVANCE_OFFSETS = [-3, -1] as const;

/** 始终提醒的档位：到期当天与逾期 1 天，不受 remindDays 影响 */
export const DEADLINE_ALWAYS_OFFSETS = [0, 1] as const;

/** remindDays 取默认值 3 时的有效偏移集合（即历史固定扫描档） */
export const DEADLINE_DEFAULT_OFFSETS = [-3, -1, 0, 1] as const;

/** remindDays 合法值：正整数（0 表示"不额外提前"，不产生新档位） */
function isValidRemindDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function collectOffsets(remindDaysValues: Iterable<unknown>): number[] {
  const set = new Set<number>([
    ...DEADLINE_FIXED_ADVANCE_OFFSETS,
    ...DEADLINE_ALWAYS_OFFSETS
  ]);
  for (const v of remindDaysValues) {
    if (isValidRemindDays(v)) set.add(-v);
  }
  // 升序：从最提前的档到逾期 +1
  return [...set].sort((a, b) => a - b);
}

/**
 * 单个期限的有效提醒偏移（升序）：
 * 固定提前档 {-3, -1} ∪ {-remindDays}，再加始终提醒的 {0, +1}。
 * remindDays 非法（缺失 / 非整数 / 小于 1）时只保留固定档，
 * 不让脏配置把提醒挪到逾期档之后。
 */
export function deadlineReminderOffsets(
  remindDays: number | null | undefined
): number[] {
  return collectOffsets([remindDays]);
}

/**
 * 一次扫描需要覆盖的全部偏移档（升序）：所有在办期限 remindDays 值
 * 与固定档的并集。用于按天扫描时的目标日期列表。
 */
export function deadlineScanOffsets(
  remindDaysValues: readonly unknown[]
): number[] {
  return collectOffsets(remindDaysValues);
}

/** 某个期限在某个偏移档上是否应提醒（与 deadlineReminderOffsets 保持一致） */
export function shouldRemindDeadlineAt(
  remindDays: number | null | undefined,
  offset: number
): boolean {
  return deadlineReminderOffsets(remindDays).includes(offset);
}
