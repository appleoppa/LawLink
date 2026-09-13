// @vitest-environment node
/**
 * 10.1 门槛核验（收尾 f）——对已实现能力的汇总断言。
 *
 * 每道门槛一条 describe，作为发布核验的自动化底线；导出重建（归档包
 * 重新生成校验值比对）属人工核验项，见 docs/P1-IMPLEMENTATION-PLAN.md
 * 追加批次进度中的记录。
 *
 * 门槛清单：
 * G1 核销守卫：超余额核销拒绝（实收/应收两侧）；
 * G2 派生搜索授权过滤：无 documents.read 的会话文档桶为空、不触达查询；
 * G3 队列幂等：dedupeKey 命中已终结任务不复活、未终结覆盖改期、无键直建；
 * G4 审计同事务：业务写入与审计共用同一事务客户端（mock 断言传入同一 tx）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { db, session, canRead } = vi.hoisted(() => {
  const db: Record<string, any> = {
    payment: {}, receivable: {}, allocation: {},
    matter: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    client: { findMany: vi.fn(async () => []) },
    intake: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    jobQueue: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    engagement: { findUnique: vi.fn(), update: vi.fn() },
    engagementMatter: { upsert: vi.fn() },
    $transaction: vi.fn()
  };
  return {
    db,
    session: { user: { id: "clawyer0000000000000000001", role: "CUSTOM", rolePermissions: [] as { permissionKey: string; scope: string }[] } },
    canRead: vi.fn(async () => true)
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn(async () => {}) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));

import { allocatePayment } from "@/server/finance/allocation";
import { globalSearch } from "@/server/search/actions";
import { enqueueJob } from "@/server/cron/queue";
import { createEngagement } from "@/server/engagements/actions";
import { auditTx } from "@/server/audit";

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

beforeEach(() => {
  vi.clearAllMocks();
  canRead.mockResolvedValue(true);
});

/* ---------- G1 核销守卫 ---------- */

describe("G1 核销守卫", () => {
  it("核销合计超过实收未核销余额时整笔拒绝", async () => {
    const payment = { amount: 80, allocatedAmount: 30, status: "PARTIAL" };
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ...db,
        payment: {
          findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", amount: D(payment.amount), allocatedAmount: D(payment.allocatedAmount), status: payment.status })),
          update: vi.fn()
        },
        receivable: {
          findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", title: "AR", amount: D(100), settledAmount: D(0), status: "OPEN" })),
          update: vi.fn()
        },
        allocation: { create: vi.fn() }
      };
      return fn(tx);
    });

    await expect(
      allocatePayment({
        paymentId: "cipay0000000000000000001",
        items: [{ receivableId: "ciar00000000000000000001", amount: 40 }, { receivableId: "ciar00000000000000000002", amount: 20 }]
      })
    ).rejects.toThrow("超过该笔实收未核销余额");
  });

  it("应收余额不足 / 已全额核销均拒绝", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: {
          findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", amount: D(100), allocatedAmount: D(0), status: "UNALLOCATED" })),
          update: vi.fn()
        },
        receivable: {
          findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", title: "AR", amount: D(50), settledAmount: D(0), status: "OPEN" })),
          update: vi.fn()
        },
        allocation: { create: vi.fn() }
      };
      return fn(tx);
    });
    await expect(
      allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 60 }] })
    ).rejects.toThrow("超过其未核销余额");

    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: {
          findUniqueOrThrow: vi.fn(async () => ({ matterId: "m1", amount: D(100), allocatedAmount: D(100), status: "FULLY_ALLOCATED" })),
          update: vi.fn()
        },
        receivable: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
        allocation: { create: vi.fn() }
      };
      return fn(tx);
    });
    await expect(
      allocatePayment({ paymentId: "cipay0000000000000000001", items: [{ receivableId: "ciar00000000000000000001", amount: 1 }] })
    ).rejects.toThrow("已全额核销");
  });
});

/* ---------- G2 派生搜索授权过滤 ---------- */

describe("G2 派生搜索授权过滤", () => {
  it("无 documents.read 的自定义角色：文档桶为空且不触达候选池", async () => {
    session.user.rolePermissions = [{ permissionKey: "matters.read", scope: "OWN" }];
    const res = await globalSearch("合同");
    expect(res.documents).toEqual([]);
    expect(db.document.findMany).not.toHaveBeenCalled();
  });

  it("候选命中但逐条授权（canReadDocument，与下载同口径）失败的不外泄", async () => {
    session.user.rolePermissions = [{ permissionKey: "documents.read", scope: "OWN" }];
    db.document.findMany.mockResolvedValue([
      { id: "d1", name: "他人合同.pdf", textContent: null, uploadedById: "other", matterId: "m-x", intakeId: null, matter: { id: "m-x", internalCode: "X-1" }, intake: null }
    ]);
    canRead.mockResolvedValue(false);
    const res = await globalSearch("合同");
    expect(res.documents).toEqual([]);
  });
});

/* ---------- G3 队列幂等 ---------- */

describe("G3 队列幂等", () => {
  it("dedupeKey 命中已终结任务（SUCCESS/DEAD）不复活", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j1", status: "SUCCESS" });
    await enqueueJob({ type: "webhook-digest", payload: { text: "x" }, dedupeKey: "webhook-digest:2026-09-13" });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
    expect(db.jobQueue.update).not.toHaveBeenCalled();

    db.jobQueue.findUnique.mockResolvedValue({ id: "j1", status: "DEAD" });
    await enqueueJob({ type: "webhook-digest", payload: { text: "x" }, dedupeKey: "webhook-digest:2026-09-13" });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("未终结任务同键覆盖（改期语义）；无键直建", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j1", status: "PENDING" });
    const runAt = new Date("2026-09-14T09:00:00");
    await enqueueJob({ type: "webhook-digest", payload: { text: "new" }, dedupeKey: "webhook-digest:2026-09-13", runAt });
    expect(db.jobQueue.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "j1" },
      data: expect.objectContaining({ payload: { text: "new" }, runAt })
    }));
    expect(db.jobQueue.create).not.toHaveBeenCalled();

    db.jobQueue.findUnique.mockResolvedValue(null);
    await enqueueJob({ type: "adhoc", payload: {}, dedupeKey: "k2" });
    expect(db.jobQueue.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "adhoc", dedupeKey: "k2", maxAttempts: 5 })
    }));
  });
});

/* ---------- G4 审计同事务 ---------- */

describe("G4 审计与业务写入同事务", () => {
  it("创建委托时 auditTx 收到的正是业务写入使用的同一事务客户端", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { ...db, engagement: { create: vi.fn(async () => ({ id: "cengage00000000000000000001" })) } };
      const result = await fn(tx);
      // 业务与审计必须看到同一个 tx：断言 auditTx 第一参数即业务 tx
      expect(auditTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "ENGAGEMENT_CREATE" }));
      return result;
    });
    db.client = { findUnique: vi.fn(async () => ({ id: "cclient00000000000000000001", name: "客户", deletedAt: null })) };

    const res = await createEngagement({ clientId: "cclient00000000000000000001", title: "门槛核验委托" });
    expect(res.ok).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
