import { describe, it, expect } from "vitest";
import { periodPresets, customPeriod } from "@/server/reports/queries";
// 2026-09-20 第五轮审计：断言统一上海口径取日——此前本地取日与旧实现同 TZ 自洽，
// 换时区跑（vitest 在 UTC 容器）就互相掩盖；修复后的实现按上海窗口，断言亦然。
import { shParts } from "@/lib/ui/sh-time";

function ymd(d: Date): [number, number, number] {
  const p = shParts(d);
  return [p.y, p.m, p.d];
}

describe("periodPresets", () => {
  it("2026-05-26 → 本月 = 2026-05-01 到 2026-06-01", () => {
    const p = periodPresets(new Date(2026, 4, 26));
    expect(ymd(p.month.start)).toEqual([2026, 5, 1]);
    expect(ymd(p.month.end)).toEqual([2026, 6, 1]);
    expect(p.month.label).toBe("2026 年 5 月");
  });

  it("2026-05-26 → 本季 = 2026 Q2（4-7 月）", () => {
    const p = periodPresets(new Date(2026, 4, 26));
    expect(ymd(p.quarter.start)).toEqual([2026, 4, 1]);
    expect(ymd(p.quarter.end)).toEqual([2026, 7, 1]);
    expect(p.quarter.label).toBe("2026 年 Q2");
  });

  it("2026-05-26 → 本年 = 2026-01-01 到 2027-01-01", () => {
    const p = periodPresets(new Date(2026, 4, 26));
    expect(ymd(p.year.start)).toEqual([2026, 1, 1]);
    expect(ymd(p.year.end)).toEqual([2027, 1, 1]);
    expect(p.year.label).toBe("2026 年度");
  });

  it("2026-05-26 → 上年 = 2025-01-01 到 2026-01-01", () => {
    const p = periodPresets(new Date(2026, 4, 26));
    expect(ymd(p.lastYear.start)).toEqual([2025, 1, 1]);
    expect(ymd(p.lastYear.end)).toEqual([2026, 1, 1]);
    expect(p.lastYear.label).toBe("2025 年度");
  });

  it("Q1（1 月）边界", () => {
    const p = periodPresets(new Date(2026, 0, 15));
    expect(ymd(p.quarter.start)).toEqual([2026, 1, 1]);
    expect(ymd(p.quarter.end)).toEqual([2026, 4, 1]);
    expect(p.quarter.label).toBe("2026 年 Q1");
  });

  it("Q4（12 月）边界，本月 end 跨年", () => {
    const p = periodPresets(new Date(2026, 11, 31));
    expect(ymd(p.month.start)).toEqual([2026, 12, 1]);
    expect(ymd(p.month.end)).toEqual([2027, 1, 1]);
    expect(ymd(p.quarter.start)).toEqual([2026, 10, 1]);
    expect(ymd(p.quarter.end)).toEqual([2027, 1, 1]);
  });

  // 2026-09-20 第五轮审计时区回归：窗口按上海年月构造，与运行时区无关。
  // 此前实现本地取月，UTC 容器上「本月」窗口=上海 1 日 08:00 起，月初 0-8 点数据落上月。
  it("上海已进新月而 UTC 仍在上月时（09-30T20:00Z）→ 本月窗口按上海 10 月", () => {
    const p = periodPresets(new Date("2026-09-30T20:00:00Z")); // 上海 10-01 04:00
    expect(p.month.start.toISOString()).toBe("2026-09-30T16:00:00.000Z"); // 上海 10-01 00:00
    expect(p.month.end.toISOString()).toBe("2026-10-31T16:00:00.000Z");   // 上海 11-01 00:00
    expect(p.month.label).toBe("2026 年 10 月");
  });

  it("元旦交界（12-31T20:00Z = 上海次年 1 月）→ 年度窗口按上海新年份", () => {
    const p = periodPresets(new Date("2026-12-31T20:00:00Z")); // 上海 2027-01-01 04:00
    expect(p.year.label).toBe("2027 年度");
    expect(p.year.start.toISOString()).toBe("2026-12-31T16:00:00.000Z"); // 上海 2027-01-01 00:00
  });
});

describe("customPeriod", () => {
  it("2026-01-01 ~ 2026-03-31 → start=01-01, end=04-01（含末日 → 半开 +1）", () => {
    const p = customPeriod("2026-01-01", "2026-03-31");
    expect(ymd(p.start)).toEqual([2026, 1, 1]);
    expect(ymd(p.end)).toEqual([2026, 4, 1]);
    expect(p.label).toBe("2026-01-01 ~ 2026-03-31");
  });

  it("月末跨月正确递增（2026-01-31 → 2026-02-01）", () => {
    const p = customPeriod("2026-01-01", "2026-01-31");
    expect(ymd(p.end)).toEqual([2026, 2, 1]);
  });

  it("日期格式不合法抛错", () => {
    expect(() => customPeriod("2026/01/01", "2026-03-31")).toThrow(/格式/);
    expect(() => customPeriod("2026-1-1", "2026-3-31")).toThrow(/格式/);
  });

  it("同一天合法（含当天 → 半开 +1 后仍 > start）", () => {
    expect(() => customPeriod("2026-03-01", "2026-03-01")).not.toThrow();
  });

  it("end < start 抛错", () => {
    expect(() => customPeriod("2026-03-01", "2026-02-28")).toThrow(/晚于/);
  });

  it("跨度 > 5 年抛错", () => {
    expect(() => customPeriod("2020-01-01", "2026-01-02")).toThrow(/5 年/);
  });

  it("正好 5 年内合法", () => {
    expect(() => customPeriod("2021-01-01", "2025-12-31")).not.toThrow();
  });

  // 2026-09-20 第五轮审计时区回归：自定义区间按上海日界解释（绝对时刻断言，与运行时区无关）
  it("customPeriod 按上海日界（2026-09-20 = 09-19T16:00Z 起）", () => {
    const p = customPeriod("2026-09-20", "2026-09-20");
    expect(p.start.toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-09-20T16:00:00.000Z"); // 含当天 → 半开 +1
  });
});
