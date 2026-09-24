/**
 * v0.22: 报表 analytics 聚合算法测试（纯函数路径）
 *
 * getCaseCycleAnalysis / getReviewIssueAnalysis 本身依赖 prisma，重写一个纯函数
 * 版本不现实；这里通过 mock prisma 测算法（中位数、空数据、JS 端聚合）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { matterFindManyMock, reviewFindManyMock } = vi.hoisted(() => ({
  matterFindManyMock: vi.fn(),
  reviewFindManyMock: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findMany: matterFindManyMock },
    reviewRecord: { findMany: reviewFindManyMock }
  }
}));

import {
  getCaseCycleAnalysis,
  getReviewIssueAnalysis
} from "@/server/reports/analytics";

const period = {
  label: "test",
  start: new Date(2026, 0, 1),
  end: new Date(2027, 0, 1)
};

beforeEach(() => {
  matterFindManyMock.mockReset();
  reviewFindManyMock.mockReset();
});

describe("getCaseCycleAnalysis", () => {
  it("空 → 空数组", async () => {
    matterFindManyMock.mockResolvedValue([]);
    const r = await getCaseCycleAnalysis(period);
    expect(r).toEqual([]);
  });

  it("民事 5 条计算 avg/median/min/max", async () => {
    const d = (offset: number) => {
      const dt = new Date(2026, 0, 1);
      dt.setDate(dt.getDate() + offset);
      return dt;
    };
    matterFindManyMock.mockResolvedValue([
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(10) }, // 10
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(20) }, // 20
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(30) }, // 30
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(40) }, // 40
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(100) } // 100
    ]);
    const r = await getCaseCycleAnalysis(period);
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(5);
    expect(r[0].avgDays).toBe(40); // (10+20+30+40+100)/5
    expect(r[0].medianDays).toBe(30); // 中间
    expect(r[0].minDays).toBe(10);
    expect(r[0].maxDays).toBe(100);
  });

  it("偶数样本：中位数取两中间均值", async () => {
    const d = (offset: number) => {
      const dt = new Date(2026, 0, 1);
      dt.setDate(dt.getDate() + offset);
      return dt;
    };
    matterFindManyMock.mockResolvedValue([
      { category: "CRIMINAL", createdAt: d(0), closedAt: d(10) },
      { category: "CRIMINAL", createdAt: d(0), closedAt: d(20) },
      { category: "CRIMINAL", createdAt: d(0), closedAt: d(30) },
      { category: "CRIMINAL", createdAt: d(0), closedAt: d(40) }
    ]);
    const r = await getCaseCycleAnalysis(period);
    expect(r[0].medianDays).toBe(25); // (20+30)/2
  });

  it("多 category 按 count 倒序", async () => {
    const d = (offset: number) => {
      const dt = new Date(2026, 0, 1);
      dt.setDate(dt.getDate() + offset);
      return dt;
    };
    matterFindManyMock.mockResolvedValue([
      { category: "ADMINISTRATIVE", createdAt: d(0), closedAt: d(5) },
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(5) },
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(5) },
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(5) }
    ]);
    const r = await getCaseCycleAnalysis(period);
    expect(r.map((x) => x.category)).toEqual(["CIVIL_COMMERCIAL", "ADMINISTRATIVE"]);
  });

  it("closedAt < createdAt 的脏数据被丢弃", async () => {
    const d = (offset: number) => {
      const dt = new Date(2026, 0, 1);
      dt.setDate(dt.getDate() + offset);
      return dt;
    };
    matterFindManyMock.mockResolvedValue([
      { category: "CIVIL_COMMERCIAL", createdAt: d(10), closedAt: d(5) }, // 脏：-5
      { category: "CIVIL_COMMERCIAL", createdAt: d(0), closedAt: d(10) }
    ]);
    const r = await getCaseCycleAnalysis(period);
    expect(r[0].count).toBe(1);
    expect(r[0].avgDays).toBe(10);
  });
});

describe("getReviewIssueAnalysis", () => {
  it("空 → 0 计数", async () => {
    reviewFindManyMock.mockResolvedValue([]);
    const r = await getReviewIssueAnalysis(period);
    expect(r.recordCount).toBe(0);
    expect(r.totalItems).toBe(0);
    expect(r.topIssues).toEqual([]);
    expect(r.bySeverity).toEqual({ HIGH: 0, MEDIUM: 0, LOW: 0 });
  });

  it("聚合 severity / type / topIssues", async () => {
    reviewFindManyMock.mockResolvedValue([
      {
        id: "r1",
        documentId: "d1",
        itemsJson: [
          { type: "RISK", severity: "HIGH", title: "违约责任缺失", detail: "x" },
          { type: "MISSING", severity: "MEDIUM", title: "管辖约定模糊", detail: "x" }
        ]
      },
      {
        id: "r2",
        documentId: "d2",
        itemsJson: [
          { type: "RISK", severity: "HIGH", title: "违约责任缺失", detail: "x" },
          { type: "RISK", severity: "HIGH", title: "违约责任缺失", detail: "x" },
          { type: "SUGGESTION", severity: "LOW", title: "措辞建议", detail: "x" }
        ]
      },
      {
        id: "r3",
        documentId: "d1", // 重复同一 doc
        itemsJson: [
          { type: "RISK", severity: "MEDIUM", title: "违约责任缺失", detail: "x" }
        ]
      }
    ]);
    const r = await getReviewIssueAnalysis(period);
    expect(r.recordCount).toBe(3);
    expect(r.documentCount).toBe(2); // d1, d2
    expect(r.totalItems).toBe(6);
    expect(r.bySeverity).toEqual({ HIGH: 3, MEDIUM: 2, LOW: 1 });
    expect(r.byType).toEqual({ MISSING: 1, RISK: 4, ISSUE: 0, SUGGESTION: 1 });
    expect(r.topIssues[0].title).toBe("违约责任缺失");
    expect(r.topIssues[0].occurrences).toBe(4);
    expect(r.topIssues[0].severityCounts).toEqual({ HIGH: 3, MEDIUM: 1, LOW: 0 });
  });

  it("topIssues 限 10 条", async () => {
    reviewFindManyMock.mockResolvedValue([
      {
        id: "r1",
        documentId: "d1",
        itemsJson: Array.from({ length: 15 }, (_, i) => ({
          type: "ISSUE",
          severity: "LOW",
          title: `问题${i}`,
          detail: "x"
        }))
      }
    ]);
    const r = await getReviewIssueAnalysis(period);
    expect(r.topIssues).toHaveLength(10);
  });

  it("空 title 不进 topIssues", async () => {
    reviewFindManyMock.mockResolvedValue([
      {
        id: "r1",
        documentId: "d1",
        itemsJson: [
          { type: "RISK", severity: "HIGH", title: "  ", detail: "x" },
          { type: "RISK", severity: "HIGH", title: "正常", detail: "x" }
        ]
      }
    ]);
    const r = await getReviewIssueAnalysis(period);
    expect(r.totalItems).toBe(2);
    expect(r.topIssues).toHaveLength(1);
    expect(r.topIssues[0].title).toBe("正常");
  });
});
