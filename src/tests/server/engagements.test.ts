// @vitest-environment node
/**
 * 委托（Engagement）动作单测 —— P2 五对象第一步收口。
 *
 * 覆盖 TARGET-MODEL-PLAN 纵向样例：
 * - 样例 1：一份委托关联多个事项（创建时同时挂链 + 审计）；
 * - 样例 5：委托终止后不可再关联事项，但历史关联保留在列表中；
 * - 越权防线（2026-09-20 第五轮审计 P2 修复后口径）：挂链/终止按经办断言
 *   （assertCanHandleMatter：主办/成员 + 合伙人例外），不再以读可见性当写守卫。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session } = vi.hoisted(() => {
  const db: Record<string, any> = {
    client: { findUnique: vi.fn() },
    matter: { count: vi.fn(), findFirst: vi.fn() },
    engagement: { findUnique: vi.fn(), update: vi.fn() },
    engagementMatter: { upsert: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn()
  };
  return {
    db,
    session: { user: { id: "clawyer0000000000000000001", role: "LAWYER", rolePermissions: undefined } }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createEngagement, linkEngagementMatter, terminateEngagement, listEngagementsForMatter } from "@/server/engagements/actions";
import { auditTx } from "@/server/audit";

const CLIENT_ID = "cclient000000000000000001";
const ENG_ID = "cengage0000000000000000001";
const M1 = "cmatter00000000000000000001";
const M2 = "cmatter00000000000000000002";

/** 事务直接以 db 充当 tx；engagement.create 只在 create 路径出现，按需注入 */
function mockTx(overrides: Record<string, any> = {}) {
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...db, ...overrides }));
}

/** 经办断言放行（LAWYER：matterAssociationFilter 命中） */
function mockHandled() {
  db.matter.findFirst.mockResolvedValue({ id: M1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTx();
  mockHandled();
});

describe("创建委托（样例 1：一委托多事项）", () => {
  it("创建委托并同时关联多个事项，写入挂链与审计", async () => {
    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "客户甲", deletedAt: null });
    const create = vi.fn(async () => ({ id: ENG_ID }));
    mockTx({ engagement: { create } });

    const res = await createEngagement({
      clientId: CLIENT_ID,
      title: "2026 年度法律顾问委托",
      scopeText: "常年法律顾问",
      matterIds: [M1, M2]
    });

    expect(res).toEqual({ ok: true, id: ENG_ID });
    // 逐案经办断言（挂链属结构性写入）
    expect(db.matter.findFirst).toHaveBeenCalledTimes(2);
    // 挂链在同一事务内随委托创建
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientId: CLIENT_ID,
        matters: { create: [{ matterId: M1 }, { matterId: M2 }] }
      })
    }));
    expect(auditTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "ENGAGEMENT_CREATE",
      targetType: "Engagement",
      targetId: ENG_ID
    }));
  });

  it("matterIds 省略时创建纯委托（不挂链）", async () => {
    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "客户甲", deletedAt: null });
    const create = vi.fn(async () => ({ id: ENG_ID }));
    mockTx({ engagement: { create } });

    const res = await createEngagement({ clientId: CLIENT_ID, title: "单独委托" });
    expect(res.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matters: { create: [] } })
    }));
    expect(db.matter.findFirst).not.toHaveBeenCalled();
  });

  it("客户不存在或已停用时拒绝", async () => {
    db.client.findUnique.mockResolvedValue(null);
    await expect(createEngagement({ clientId: CLIENT_ID, title: "x" })).rejects.toThrow("客户不存在或已停用");

    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, deletedAt: new Date() });
    await expect(createEngagement({ clientId: CLIENT_ID, title: "x" })).rejects.toThrow("客户不存在或已停用");
  });

  it("非经办事项被拒（读可见性不再是写守卫）", async () => {
    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "客户甲", deletedAt: null });
    db.matter.findFirst.mockResolvedValue(null); // 经办断言不命中

    await expect(
      createEngagement({ clientId: CLIENT_ID, title: "越权委托", matterIds: [M1, M2] })
    ).rejects.toThrow("案件不存在或无权关联");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("终止委托（样例 5：终止不校验财务，历史保留）", () => {
  it("关联案件经办的律师可终止，写入 endedAt 与原因并记录审计（不做财务校验）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null, matters: [{ matterId: M1 }] });
    db.engagement.update.mockResolvedValue({ id: ENG_ID });

    const res = await terminateEngagement({ engagementId: ENG_ID, reason: "委托期满" });
    expect(res).toEqual({ ok: true });
    expect(db.engagement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ENG_ID },
      data: expect.objectContaining({ terminatedReason: "委托期满" })
    }));
    expect(db.engagement.update.mock.calls[0][0].data.endedAt).toBeInstanceOf(Date);
    expect(auditTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "ENGAGEMENT_TERMINATE",
      targetId: ENG_ID
    }));
    // 终止路径不触碰任何财务模型
    expect(Object.keys(db).filter(k => /receivable|payment|billing|feeEntry/i.test(k)).length).toBe(0);
  });

  it("关联案件均无经办的律师被拒（此前完全无对象校验）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null, matters: [{ matterId: M1 }] });
    db.matter.findFirst.mockResolvedValue(null);
    await expect(terminateEngagement({ engagementId: ENG_ID, reason: "越权终止" })).rejects.toThrow("仅该委托关联案件的经办律师或合伙人可终止委托");
    expect(db.engagement.update).not.toHaveBeenCalled();
  });

  it("未关联案件的委托仅合伙人可终止", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null, matters: [] });
    await expect(terminateEngagement({ engagementId: ENG_ID, reason: "x" })).rejects.toThrow("未关联案件的委托仅合伙人可终止");

    const { requireSession } = await import("@/lib/auth/session");
    vi.mocked(requireSession).mockResolvedValueOnce({ user: { id: "clawyer0000000000000000001", role: "PRINCIPAL_LAWYER" } } as never);
    db.engagement.update.mockResolvedValue({ id: ENG_ID });
    await expect(terminateEngagement({ engagementId: ENG_ID, reason: "合伙人终止" })).resolves.toEqual({ ok: true });
  });

  it("重复终止被拒绝", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: new Date(), matters: [{ matterId: M1 }] });
    await expect(terminateEngagement({ engagementId: ENG_ID, reason: "再终止" })).rejects.toThrow("委托已终止");
  });

  it("终止后不可再关联事项", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: new Date() });
    await expect(
      linkEngagementMatter({ engagementId: ENG_ID, matterId: M1 })
    ).rejects.toThrow("委托已终止，不可再关联事项");
    expect(db.engagementMatter.upsert).not.toHaveBeenCalled();
  });

  it("终止后历史关联仍出现在案件委托列表中", async () => {
    const endedAt = new Date("2026-08-01");
    db.engagementMatter.findMany.mockResolvedValue([
      {
        validFrom: new Date("2026-01-01"),
        validTo: null,
        engagement: {
          id: ENG_ID, title: "已终止的委托", scopeText: null, feeNote: null,
          startedAt: new Date("2026-01-01"), endedAt, terminatedReason: "委托期满",
          client: { id: CLIENT_ID, name: "客户甲" }
        }
      }
    ]);
    const rows = await listEngagementsForMatter(M1);
    expect(rows).toHaveLength(1);
    expect(rows[0].engagement.endedAt).toEqual(endedAt);
    expect(rows[0].engagement.terminatedReason).toBe("委托期满");
  });
});

describe("补挂事项到既有委托", () => {
  it("经办事项补挂成功（upsert + 审计）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null });
    db.engagementMatter.upsert.mockResolvedValue({});

    const res = await linkEngagementMatter({ engagementId: ENG_ID, matterId: M2, validFrom: new Date("2026-03-01") });
    expect(res).toEqual({ ok: true });
    expect(db.engagementMatter.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { engagementId_matterId: { engagementId: ENG_ID, matterId: M2 } },
      create: expect.objectContaining({ matterId: M2 })
    }));
    expect(auditTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "ENGAGEMENT_LINK_MATTER",
      targetId: ENG_ID
    }));
  });

  it("非经办的案件被拒绝（读可见性不再是写守卫）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null });
    db.matter.findFirst.mockResolvedValue(null);
    await expect(
      linkEngagementMatter({ engagementId: ENG_ID, matterId: M1 })
    ).rejects.toThrow("案件不存在或无权关联");
    expect(db.engagementMatter.upsert).not.toHaveBeenCalled();
  });

  it("委托不存在时拒绝", async () => {
    db.engagement.findUnique.mockResolvedValue(null);
    await expect(linkEngagementMatter({ engagementId: ENG_ID, matterId: M1 })).rejects.toThrow("委托不存在");
  });
});
