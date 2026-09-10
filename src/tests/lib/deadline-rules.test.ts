import { describe, expect, it } from "vitest";
import {
  buildDeadlineBasis,
  computeDeadlineDate,
  formatLocalDate,
  periodLabel
} from "@/lib/deadline-rules";

const d = (s: string) => new Date(`${s}T00:00:00`);

describe("computeDeadlineDate", () => {
  it("按日期间：开始之日不计入，到期日 = 触发日 + N 日（民诉法第85条）", () => {
    // 判决书 7/1 送达，上诉期 15 日 → 7/16 届满
    expect(formatLocalDate(computeDeadlineDate(d("2026-07-01"), 15, "DAYS"))).toBe("2026-07-16");
    // 裁定 10 日
    expect(formatLocalDate(computeDeadlineDate(d("2026-07-01"), 10, "DAYS"))).toBe("2026-07-11");
    // 跨月
    expect(formatLocalDate(computeDeadlineDate(d("2026-01-25"), 15, "DAYS"))).toBe("2026-02-09");
  });

  it("按月期间：到期月对应日", () => {
    // 再审 6 个月
    expect(formatLocalDate(computeDeadlineDate(d("2026-01-15"), 6, "MONTHS"))).toBe("2026-07-15");
    // 撤裁 3 个月
    expect(formatLocalDate(computeDeadlineDate(d("2026-03-10"), 3, "MONTHS"))).toBe("2026-06-10");
  });

  it("按月期间：到期月无对应日取月末", () => {
    // 1/31 + 1 个月 → 2 月无 31 日 → 2/28（2026 非闰年）
    expect(formatLocalDate(computeDeadlineDate(d("2026-01-31"), 1, "MONTHS"))).toBe("2026-02-28");
    // 闰年 2/29
    expect(formatLocalDate(computeDeadlineDate(d("2028-01-31"), 1, "MONTHS"))).toBe("2028-02-29");
    // 8/31 + 6 个月 → 次年 2 月末
    expect(formatLocalDate(computeDeadlineDate(d("2026-08-31"), 6, "MONTHS"))).toBe("2027-02-28");
  });

  it("按年期间：申请执行 2 年", () => {
    expect(formatLocalDate(computeDeadlineDate(d("2026-07-04"), 2, "YEARS"))).toBe("2028-07-04");
    // 闰日触发 → 平年取 2/28
    expect(formatLocalDate(computeDeadlineDate(d("2028-02-29"), 1, "YEARS"))).toBe("2029-02-28");
  });

  it("忽略触发日的时间部分", () => {
    const withTime = new Date("2026-07-01T18:30:00");
    expect(formatLocalDate(computeDeadlineDate(withTime, 15, "DAYS"))).toBe("2026-07-16");
  });

  it("非法期限数值报错", () => {
    expect(() => computeDeadlineDate(d("2026-07-01"), 0, "DAYS")).toThrow();
    expect(() => computeDeadlineDate(d("2026-07-01"), -5, "DAYS")).toThrow();
    expect(() => computeDeadlineDate(d("2026-07-01"), 1.5, "DAYS")).toThrow();
  });
});

describe("periodLabel / buildDeadlineBasis", () => {
  it("期限单位中文标签", () => {
    expect(periodLabel(15, "DAYS")).toBe("15 日");
    expect(periodLabel(6, "MONTHS")).toBe("6 个月");
    expect(periodLabel(2, "YEARS")).toBe("2 年");
  });

  it("basis 文本包含法条、触发日期与顺延提示，且不超过 200 字（schema 上限）", () => {
    const basis = buildDeadlineBasis({
      legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百七十一条",
      triggerLabel: "判决书送达之日",
      triggerDate: d("2026-07-01"),
      periodValue: 15,
      periodUnit: "DAYS"
    });
    expect(basis).toContain("第一百七十一条");
    expect(basis).toContain("2026-07-01");
    expect(basis).toContain("15 日");
    expect(basis).toContain("法定休假日");
    expect(basis.length).toBeLessThanOrEqual(200);
  });
});
