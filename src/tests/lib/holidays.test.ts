// @vitest-environment node
/**
 * 法定放假安排引擎（F-5）：届满日顺延——放假日/普通周末顺延到下一工作日，
 * 调休上班日（WORKDAY）不视为休假日；未配置或表未建（迁移未执行）时
 * 按原日期返回 adjusted=false（优雅降级）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({ db: { holiday: { findMany: vi.fn(), count: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { nextWorkdayKey, adjustDeadlineForHolidays, loadHolidayMap, hasHolidayConfig, type HolidayMap } from "@/lib/calendar/holidays";
import { civilFromKey } from "@/lib/ui/sh-time";

const mk = (entries: Record<string, "HOLIDAY" | "WORKDAY">): HolidayMap => {
  const m: HolidayMap = new Map();
  for (const [k, kind] of Object.entries(entries)) m.set(k, { name: "测试假日", kind });
  return m;
};

describe("nextWorkdayKey（纯日历逻辑）", () => {
  it("工作日不顺延", () => {
    // 2026-07-01 是周三
    expect(nextWorkdayKey("2026-07-01", mk({}))).toBe("2026-07-01");
  });
  it("普通周末顺延到周一", () => {
    // 2026-07-04 周六 → 07-06 周一
    expect(nextWorkdayKey("2026-07-04", mk({}))).toBe("2026-07-06");
    // 2026-07-05 周日 → 07-06
    expect(nextWorkdayKey("2026-07-05", mk({}))).toBe("2026-07-06");
  });
  it("放假日顺延；跨放假日连休顺延到首个非休假日", () => {
    // 10-01（周四）起放假三天，10-02/03 也是放假日 → 顺延到 10-04（周日）？→ 周日也休 → 10-05 周一
    expect(nextWorkdayKey("2026-10-01", mk({ "2026-10-01": "HOLIDAY", "2026-10-02": "HOLIDAY", "2026-10-03": "HOLIDAY" }))).toBe("2026-10-05");
  });
  it("调休上班日（WORKDAY）不视为休假日——周末上班可作届满日", () => {
    // 2026-09-26 周六，国务院安排调休上班
    expect(nextWorkdayKey("2026-09-26", mk({ "2026-09-26": "WORKDAY" }))).toBe("2026-09-26");
  });
});

describe("adjustDeadlineForHolidays（含降级）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("已配置：届满日在放假日 → 顺延并给出原因", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: civilFromKey("2026-10-01"), name: "国庆节", kind: "HOLIDAY" }
    ]);
    const r = await adjustDeadlineForHolidays("2026-10-01");
    expect(r.adjusted).toBe(true);
    expect(r.key).toBe("2026-10-02"); // 仅 10-01 放假：10-02（周五）为下一工作日
  });

  it("未命中安排的工作日：原样返回", async () => {
    db.holiday.findMany.mockResolvedValue([]);
    const r = await adjustDeadlineForHolidays("2026-07-01");
    expect(r).toEqual({ key: "2026-07-01", adjusted: false });
  });

  it("表未建（迁移未执行）：查询报错按未配置降级", async () => {
    db.holiday.findMany.mockRejectedValue(new Error("relation \"holiday\" does not exist"));
    const r = await adjustDeadlineForHolidays("2026-10-01");
    expect(r.adjusted).toBe(false);
    expect(r.key).toBe("2026-10-01");
    expect(await hasHolidayConfig()).toBe(false);
  });
});

describe("loadHolidayMap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("读出的安排按上海日历日键入表", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: civilFromKey("2026-10-01"), name: "国庆节", kind: "HOLIDAY" },
      { date: civilFromKey("2026-09-26"), name: "上班", kind: "WORKDAY" }
    ]);
    const m = await loadHolidayMap("2026-09-01", "2026-12-31");
    expect(m.get("2026-10-01")).toEqual({ name: "国庆节", kind: "HOLIDAY" });
    expect(m.get("2026-09-26")?.kind).toBe("WORKDAY");
  });
});
