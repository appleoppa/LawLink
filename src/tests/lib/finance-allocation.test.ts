// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { db, session } = vi.hoisted(() => {
  const tables = ["receivable", "payment", "allocation", "financeCorrection", "auditLog", "matter"] as const;
  const methods = ["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "count", "create", "update", "upsert", "createMany", "deleteMany", "delete"] as const;
  const models = Object.fromEntries(tables.map(t => [t, Object.fromEntries(methods.map(m => [m, vi.fn()]))]));
  const dbObj = { ...models, $transaction: vi.fn() };
  return {
    db: dbObj as Record<string, any>,
    session: { user: { id: "clawyer0000000000000000001", role: "FINANCE", rolePermissions: undefined } }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// 本组覆盖未升级库；升级后的并发/金额/权限由 verify-workflow-ledger.ts 真实 PostgreSQL 验证。
vi.mock("@/server/finance/ledger-storage", () => ({ financeLedgerReady: vi.fn(async () => false) }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn(async () => {}) }));

import { allocatePayment } from "@/server/finance/allocation";

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** 模拟事务：直接把 tx 指向 db，并让数值状态按 update 语义推进 */
function mockTxWith(payment: { amount: number; allocatedAmount: number; status: string },
                    receivables: Record<string, { amount: number; settledAmount: number; status: string }>) {
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      ...db,
      payment: {
        findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", ...payment, amount: D(payment.amount), allocatedAmount: D(payment.allocatedAmount) })),
        update: vi.fn(async ({ data }: any) => {
          if (data.allocatedAmount?.increment) payment.allocatedAmount += Number(data.allocatedAmount.increment);
          if (data.status) payment.status = data.status;
          return { amount: D(payment.amount), allocatedAmount: D(payment.allocatedAmount) };
        })
      },
      receivable: {
        findUniqueOrThrow: vi.fn(async ({ where }: any) => {
          const r = receivables[where.id];
          if (!r) throw new Error("应收不存在");
          return { matterId: "m1", title: `AR-${where.id}`, amount: D(r.amount), settledAmount: D(r.settledAmount), status: r.status };
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const r = receivables[where.id];
          if (data.settledAmount?.increment) r.settledAmount += Number(data.settledAmount.increment);
          if (data.status) r.status = data.status;
          return { amount: D(r.amount), settledAmount: D(r.settledAmount) };
        })
      },
      allocation: { create: vi.fn(async () => ({ id: "a1" })) },
      auditLog: { create: vi.fn() }
    };
    return fn(tx);
  });
}

describe("财务核销（P1 §二）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("一次实收核销两项应收，全额后状态置 SETTLED/FULLY_ALLOCATED", async () => {
    const payment = { amount: 100, allocatedAmount: 0, status: "UNALLOCATED" };
    const ars = {
      ciar00000000000000000001: { amount: 60, settledAmount: 0, status: "OPEN" },
      ciar00000000000000000002: { amount: 40, settledAmount: 0, status: "OPEN" }
    };
    mockTxWith(payment, ars);
    const res = await allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 60 }, { receivableId: "ciar00000000000000000002", amount: 40 }] });
    expect(res).toEqual({ ok: true });
    expect(ars.ciar00000000000000000001.settledAmount).toBe(60);
    expect(ars.ciar00000000000000000002.settledAmount).toBe(40);
    expect(payment.allocatedAmount).toBe(100);
  });

  it("部分核销：应收余额不足时整笔拒绝（事务回滚语义）", async () => {
    mockTxWith(
      { amount: 100, allocatedAmount: 0, status: "UNALLOCATED" },
      { ciar00000000000000000001: { amount: 50, settledAmount: 0, status: "OPEN" } }
    );
    await expect(
      allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 60 }] })
    ).rejects.toThrow("超过其未核销余额");
  });

  it("核销合计超过实收余额时拒绝", async () => {
    mockTxWith(
      { amount: 80, allocatedAmount: 30, status: "PARTIAL" },
      {
        ciar00000000000000000001: { amount: 100, settledAmount: 0, status: "OPEN" },
        ciar00000000000000000002: { amount: 100, settledAmount: 0, status: "OPEN" }
      }
    );
    await expect(
      allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 40 }, { receivableId: "ciar00000000000000000002", amount: 20 }] })
    ).rejects.toThrow("超过该笔实收未核销余额");
  });

  it("已全额核销的实收不可再核销；作废应收不可核销", async () => {
    mockTxWith({ amount: 100, allocatedAmount: 100, status: "FULLY_ALLOCATED" }, {});
    await expect(allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 1 }] })).rejects.toThrow("已全额核销");

    mockTxWith({ amount: 100, allocatedAmount: 0, status: "UNALLOCATED" }, { ciar00000000000000000001: { amount: 100, settledAmount: 0, status: "CANCELLED" } });
    await expect(allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 10 }] })).rejects.toThrow("已作废");
  });

  it("跨案件核销拒绝", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: { findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", amount: D(100), allocatedAmount: D(0), status: "UNALLOCATED" })) },
        receivable: { findUniqueOrThrow: vi.fn(async () => ({ matterId: "m2", title: "AR", amount: D(50), settledAmount: D(0), status: "OPEN" })) }
      };
      return fn(tx);
    });
    await expect(allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar000000000000000000xx", amount: 10 }] })).rejects.toThrow("不属于同一案件");
  });
});
