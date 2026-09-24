// @vitest-environment node
/**
 * 法定期限计算（v0.49 引擎）——2026-09-21 第六轮体检 P2-1 改写。
 *
 * 断言口径：全部经 civil 载体（civilFromKey 本地正午构造 + civilKey 本地读取），
 * 与生产三个调用方同一模式——该模式本地构造+本地读取为时区无关的确定性运算，
 * 因此本文件在任何 TZ 下跑都直接断言上海日历结果，消除旧版「本地构造+本地
 * 格式化两端同源、任何时区自洽通过」的盲区（第五轮 reports-period 同款处理）。
 */
import { describe, expect, it } from "vitest";
import type { DeadlinePeriodUnit } from "@prisma/client";
import { civilFromKey, civilKey } from "@/lib/ui/sh-time";
import {
  computeDeadlineDate,
  periodLabel,
  buildDeadlineBasis,
  HOLIDAY_NOTE
} from "@/lib/deadline-rules";

const d = (key: string) => civilFromKey(key);
const keyOf = (date: Date) => civilKey(date);

describe("computeDeadlineDate", () => {
  it("按日期限：开始之日不计入，到期日＝触发日＋N 日（民诉法第八十五条）", () => {
    expect(keyOf(computeDeadlineDate(d("2026-07-01"), 15, "DAYS"))).toBe("2026-07-16");
    expect(keyOf(computeDeadlineDate(d("2026-07-01"), 10, "DAYS"))).toBe("2026-07-11");
    // 跨月
    expect(keyOf(computeDeadlineDate(d("2026-01-25"), 15, "DAYS"))).toBe("2026-02-09");
  });
  it("按月/年：到期月对应日；无对应日取月末（月末钳制）", () => {
    expect(keyOf(computeDeadlineDate(d("2026-01-15"), 6, "MONTHS"))).toBe("2026-07-15");
    expect(keyOf(computeDeadlineDate(d("2026-03-10"), 3, "MONTHS"))).toBe("2026-06-10");
    expect(keyOf(computeDeadlineDate(d("2026-01-31"), 1, "MONTHS"))).toBe("2026-02-28");
    expect(keyOf(computeDeadlineDate(d("2028-01-31"), 1, "MONTHS"))).toBe("2028-02-29");
    expect(keyOf(computeDeadlineDate(d("2026-08-31"), 6, "MONTHS"))).toBe("2027-02-28");
    expect(keyOf(computeDeadlineDate(d("2026-07-04"), 2, "YEARS"))).toBe("2028-07-04");
    // 闰日到期年非闰 → 取 2 月末（二十年最长保护期一类场景）
    expect(keyOf(computeDeadlineDate(d("2028-02-29"), 1, "YEARS"))).toBe("2029-02-28");
  });
  it("载体带时间部分不影响日历结果（civil 载体正午，任何时区同值）", () => {
    const withTime = new Date(civilFromKey("2026-07-01").getTime() + 5 * 3_600_000);
    expect(keyOf(computeDeadlineDate(withTime, 15, "DAYS"))).toBe("2026-07-16");
  });
  it("非正整数期限拒绝", () => {
    const invalid: Array<[number, DeadlinePeriodUnit]> = [[0, "DAYS"], [-5, "DAYS"], [1.5, "DAYS"]];
    for (const [v, unit] of invalid) {
      expect(() => computeDeadlineDate(d("2026-07-01"), v, unit)).toThrow();
    }
  });
  it("P2-4 新增规则口径抽查：三年时效与二十年保护期", () => {
    expect(keyOf(computeDeadlineDate(d("2024-03-15"), 3, "YEARS"))).toBe("2027-03-15");
    expect(keyOf(computeDeadlineDate(d("2006-09-21"), 20, "YEARS"))).toBe("2026-09-21");
  });
});

describe("periodLabel / buildDeadlineBasis", () => {
  it("标签与依据文本（含顺延提示）", () => {
    expect(periodLabel(15, "DAYS")).toBe("15 日");
    expect(periodLabel(6, "MONTHS")).toBe("6 个月");
    expect(periodLabel(3, "YEARS")).toBe("3 年");
    const basis = buildDeadlineBasis({
      legalBasis: "《民事诉讼法》第八十五条",
      triggerLabel: "判决书送达之日",
      triggerDate: d("2026-07-01"),
      periodValue: 15,
      periodUnit: "DAYS"
    });
    expect(basis).toContain("《民事诉讼法》第八十五条");
    expect(basis).toContain("2026-07-01");
    expect(basis).toContain(HOLIDAY_NOTE);
  });
});
