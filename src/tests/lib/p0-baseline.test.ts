// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/* ---------- 纯函数：客户身份规范化 ---------- */
import {
  normalizeIdNumber, suggestIdType, duplicateWhereInput, nameWhereInput
} from "@/lib/clients/identity";

describe("客户身份规范化（P0-1）", () => {
  it("去首尾空白并统一大写（身份证尾号 x、信用代码小写）", () => {
    expect(normalizeIdNumber(" 11010119900101123x ")).toBe("11010119900101123X");
    expect(normalizeIdNumber(" 91110000ma0abcdefg ")).toBe("91110000MA0ABCDEFG");
  });
  it("空值归 null", () => {
    expect(normalizeIdNumber("")).toBeNull();
    expect(normalizeIdNumber("   ")).toBeNull();
    expect(normalizeIdNumber(null)).toBeNull();
    expect(normalizeIdNumber(undefined)).toBeNull();
  });
  it("按主体类型建议证件类型", () => {
    expect(suggestIdType("PERSON")).toBe("ID_CARD");
    expect(suggestIdType("COMPANY")).toBe("USCC");
    expect(suggestIdType("ORG")).toBe("USCC");
    expect(suggestIdType("UNKNOWN")).toBeNull();
    expect(suggestIdType("INDIVIDUAL")).toBe("ID_CARD");
    expect(suggestIdType("ORGANIZATION")).toBe("USCC");
  });
  it("查重条件：证件精确走盲索引（P1 §三）+ 同名未删（排除自身）", () => {
    expect(duplicateWhereInput({ idType: "ID_CARD", idNumber: "X" })).toEqual({
      idType: "ID_CARD", idNumberBlind: expect.any(String)
    });
    expect(duplicateWhereInput({ idType: "USCC", idNumber: "Y", excludeId: "c1" })).toEqual({
      idType: "USCC", idNumberBlind: expect.any(String), id: { not: "c1" }
    });
    expect(nameWhereInput({ name: "张三" })).toEqual({ name: "张三", deletedAt: null });
    expect(nameWhereInput({ name: "张三", excludeId: "c1" })).toEqual({
      name: "张三", deletedAt: null, id: { not: "c1" }
    });
  });
});

/* ---------- 团队受限事项过滤（制度决策 4.1） ---------- */
import { teamMatterFilter } from "@/lib/permissions";

describe("团队汇总排除受限事项（4.1 选项 A）", () => {
  it("teamMatterFilter 的查询条件包含 teamAccessRestricted: false", () => {
    const filter = teamMatterFilter("u1") as { AND: object[]; OR: object[] };
    expect(filter.AND).toEqual([{ teamAccessRestricted: false }]);
    expect(filter.OR).toBeDefined();
  });
});

/* ---------- 财务删除守卫（P0-6） ---------- */
const { db, session } = vi.hoisted(() => {
  const tables = ["billing", "feeEntry", "matter", "commissionPlan", "systemSetting", "auditLog"] as const;
  const methods = ["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "count", "create", "update", "upsert", "createMany", "deleteMany", "delete"] as const;
  const models = Object.fromEntries(tables.map(t => [t, Object.fromEntries(methods.map(m => [m, vi.fn()]))]));
  const dbObj = { ...models, $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...models })) };
  return {
    db: dbObj as Record<string, any>,
    session: { user: { id: "clawyer0000000000000000001", role: "PRINCIPAL_LAWYER", rolePermissions: undefined } }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn(), auditStrict: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/approvals/service", () => ({
  requireApprovalRoute: vi.fn(), assertApprovalItem: vi.fn(),
  approvalTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  approvalAudit: vi.fn()
}));

import { deleteBilling, deleteFeeEntry } from "@/server/finance/actions";

describe("财务删除守卫（P0-6）", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
    db.matter.findFirst.mockResolvedValue({ id: "m1", status: "IN_PROGRESS" });
  });

  it("已签署合同拒绝删除", async () => {
    db.billing.findUnique.mockResolvedValue({ matterId: "m1", signedAt: new Date(), title: "合同" });
    await expect(deleteBilling("b1")).rejects.toThrow("已签署");
    expect(db.billing.delete).not.toHaveBeenCalled();
  });

  it("未签署合同仍可删除（行为不回退）", async () => {
    db.billing.findUnique.mockResolvedValue({ matterId: "m1", signedAt: null, title: "合同" });
    await expect(deleteBilling("b1")).resolves.toEqual({ ok: true });
  });

  it("关联已签署合同的收付记录拒绝删除", async () => {
    db.feeEntry.findUnique.mockResolvedValue({
      id: "f1", matterId: "m1", invoiceNo: null,
      commissionChildren: [], billing: { signedAt: new Date() }
    });
    await expect(deleteFeeEntry("f1")).rejects.toThrow("已签署合同");
    expect(db.feeEntry.delete).not.toHaveBeenCalled();
  });

  it("已登记发票号的收付记录拒绝删除", async () => {
    db.feeEntry.findUnique.mockResolvedValue({
      id: "f2", matterId: "m1", invoiceNo: "INV-001",
      commissionChildren: [], billing: null
    });
    await expect(deleteFeeEntry("f2")).rejects.toThrow("发票号");
    expect(db.feeEntry.delete).not.toHaveBeenCalled();
  });

  it("普通未确认记录仍可删除并级联分成（行为不回退）", async () => {
    db.feeEntry.findUnique.mockResolvedValue({
      id: "f3", matterId: "m1", invoiceNo: null, type: "COST", confirmState: "CONFIRMED",
      commissionChildren: [{ id: "c1" }, { id: "c2" }], billing: { signedAt: null }
    });
    db.feeEntry.deleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteFeeEntry("f3")).resolves.toEqual({ ok: true });
    // 级联删分成 + 条件删父条目，都走 deleteMany（并发下按受影响行数判定）
    expect(db.feeEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] } } });
    expect(db.feeEntry.deleteMany).toHaveBeenLastCalledWith({ where: { id: "f3" } });
  });

  it("并发确认后删除落空：受影响行数为 0 时报错，不静默通过", async () => {
    db.feeEntry.findUnique.mockResolvedValue({
      id: "f4", matterId: "m1", invoiceNo: null, type: "RECEIVED", confirmState: "PENDING",
      commissionChildren: [], billing: { signedAt: null }
    });
    db.feeEntry.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteFeeEntry("f4")).rejects.toThrow("不可删除");
  });
});

/* ---------- 发号器序列化重试（P0-6） ---------- */
import { nextSystemCounter } from "@/lib/system-counter";

describe("发号计数器序列化冲突重试（P0-6）", () => {
  it("P2034 冲突时重试并成功返回", async () => {
    let calls = 0;
    db.$transaction.mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        throw new Prisma.PrismaClientKnownRequestError("serialization failure", {
          code: "P2034", clientVersion: "test"
        });
      }
      return 7;
    });
    await expect(nextSystemCounter("test-key")).resolves.toBe(7);
    expect(calls).toBe(3);
  });

  it("非序列化错误直接抛出，不重试", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(nextSystemCounter("test-key")).rejects.toThrow("connection lost");
  });

  it("连续冲突超过上限抛出（不无限重试）", async () => {
    db.$transaction.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("serialization failure", {
        code: "P2034", clientVersion: "test"
      });
    });
    await expect(nextSystemCounter("test-key")).rejects.toThrow();
  });
});
