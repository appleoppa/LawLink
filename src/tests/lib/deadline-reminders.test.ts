// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  deadlineReminderOffsets,
  deadlineScanOffsets,
  shouldRemindDeadlineAt,
  DEADLINE_DEFAULT_OFFSETS,
  DEADLINE_FIXED_ADVANCE_OFFSETS,
  DEADLINE_ALWAYS_OFFSETS
} from "@/lib/deadline-reminders";

describe("期限提醒偏移并集（固定提前档 ∪ remindDays）", () => {
  it("remindDays 为默认值 3 时与历史固定档完全一致", () => {
    expect(deadlineReminderOffsets(3)).toEqual([-3, -1, 0, 1]);
    expect(deadlineReminderOffsets(3)).toEqual([...DEADLINE_DEFAULT_OFFSETS]);
  });

  it("remindDays 缺失 / null 时按固定档处理，不影响扫描", () => {
    expect(deadlineReminderOffsets(undefined)).toEqual([-3, -1, 0, 1]);
    expect(deadlineReminderOffsets(null)).toEqual([-3, -1, 0, 1]);
  });

  it("remindDays=7 时新增 -7 档，固定档与 0/+1 保留", () => {
    expect(deadlineReminderOffsets(7)).toEqual([-7, -3, -1, 0, 1]);
  });

  it("remindDays=2 时与固定提前档去重", () => {
    expect(deadlineReminderOffsets(2)).toEqual([-3, -2, -1, 0, 1]);
  });

  it("remindDays=1 时与固定 -1 档去重", () => {
    expect(deadlineReminderOffsets(1)).toEqual([-3, -1, 0, 1]);
  });

  it("非法值（0 / 负数 / 小数 / NaN）不产生新档位，也不会把提醒挪到逾期档", () => {
    expect(deadlineReminderOffsets(0)).toEqual([-3, -1, 0, 1]);
    expect(deadlineReminderOffsets(-5)).toEqual([-3, -1, 0, 1]);
    expect(deadlineReminderOffsets(2.5)).toEqual([-3, -1, 0, 1]);
    expect(deadlineReminderOffsets(NaN)).toEqual([-3, -1, 0, 1]);
  });

  it("到期当天与逾期 1 天始终在有效集合内，不受配置影响", () => {
    for (const remindDays of [undefined, 1, 2, 3, 7, 60]) {
      const offsets = deadlineReminderOffsets(remindDays);
      expect(offsets).toContain(0);
      expect(offsets).toContain(1);
      for (const fixed of DEADLINE_FIXED_ADVANCE_OFFSETS) {
        expect(offsets).toContain(fixed);
      }
      for (const always of DEADLINE_ALWAYS_OFFSETS) {
        expect(offsets).toContain(always);
      }
    }
  });

  it("shouldRemindDeadlineAt 与 deadlineReminderOffsets 判定一致", () => {
    for (const offset of [-7, -5, -3, -1, 0, 1]) {
      expect(shouldRemindDeadlineAt(7, offset)).toBe(
        [-7, -3, -1, 0, 1].includes(offset)
      );
    }
    // 默认配置的期限不会在自定义档位上提前提醒
    expect(shouldRemindDeadlineAt(3, -7)).toBe(false);
    expect(shouldRemindDeadlineAt(undefined, -7)).toBe(false);
    // 0 / +1 恒为提醒
    expect(shouldRemindDeadlineAt(undefined, 0)).toBe(true);
    expect(shouldRemindDeadlineAt(undefined, 1)).toBe(true);
    expect(shouldRemindDeadlineAt(3, 1)).toBe(true);
  });

  it("deadlineScanOffsets 取多个期限 remindDays 的并集并升序去重", () => {
    expect(deadlineScanOffsets([])).toEqual([-3, -1, 0, 1]);
    expect(deadlineScanOffsets([3])).toEqual([-3, -1, 0, 1]);
    expect(deadlineScanOffsets([3, 3])).toEqual([-3, -1, 0, 1]);
    expect(deadlineScanOffsets([7, 3, 2, 1, 0, 7])).toEqual([-7, -3, -2, -1, 0, 1]);
    expect(deadlineScanOffsets([10, 5])).toEqual([-10, -5, -3, -1, 0, 1]);
    expect(deadlineScanOffsets([NaN, 2.5, -4])).toEqual([-3, -1, 0, 1]);
  });
});
