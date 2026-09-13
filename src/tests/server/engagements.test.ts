// @vitest-environment node
/**
 * 委托（Engagement）动作单测 —— P2 五对象第一步收口。
 *
 * 覆盖 TARGET-MODEL-PLAN 纵向样例：
 * - 样例 1：一份委托关联多个事项（创建时同时挂链 + 审计）；
 * - 样例 5：委托终止后不可再关联事项，但历史关联保留在列表中；
 * - 越权防线：关联不可见事项（matterReadVisibilityFilter 过滤）被拒。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session } = vi.hoisted(() => {
  const db: Record<string, any> = {
    client: { findUnique: vi.fn() },
    matter: { count: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockTx();
});

describe("创建委托（样例 1：一委托多事项）", () => {
  it("创建委托并同时关联多个事项，写入挂链与审计", async () => {
    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "客户甲", deletedAt: null });
    db.matter.count.mockResolvedValue(2); // 两个事项均可见
    const create = vi.fn(async () => ({ id: ENG_ID }));
    mockTx({ engagement: { create } });

    const res = await createEngagement({
      clientId: CLIENT_ID,
      title: "2026 年度法律顾问委托",
      scopeText: "常年法律顾问",
      matterIds: [M1, M2]
    });

    expect(res).toEqual({ ok: true, id: ENG_ID });
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
    expect(db.matter.count).not.toHaveBeenCalled();
  });

  it("客户不存在或已停用时拒绝", async () => {
    db.client.findUnique.mockResolvedValue(null);
    await expect(createEngagement({ clientId: CLIENT_ID, title: "x" })).rejects.toThrow("客户不存在或已停用");

    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, deletedAt: new Date() });
    await expect(createEngagement({ clientId: CLIENT_ID, title: "x" })).rejects.toThrow("客户不存在或已停用");
  });

  it("关联不可见事项被拒（可见性过滤不满足）", async () => {
    db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "客户甲", deletedAt: null });
    db.matter.count.mockResolvedValue(1); // 2 个事项只可见 1 个

    await expect(
      createEngagement({ clientId: CLIENT_ID, title: "越权委托", matterIds: [M1, M2] })
    ).rejects.toThrow("存在无权关联的案件");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("终止委托（样例 5：终止不校验财务，历史保留）", () => {
  it("终止写入 endedAt 与原因，并记录审计（不做财务校验）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null });
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

  it("重复终止被拒绝", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: new Date() });
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
  it("可见事项补挂成功（upsert + 审计）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null });
    db.matter.count.mockResolvedValue(1);
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

  it("无权关联的案件被拒绝（可见性 count 为 0）", async () => {
    db.engagement.findUnique.mockResolvedValue({ endedAt: null });
    db.matter.count.mockResolvedValue(0);
    await expect(
      linkEngagementMatter({ engagementId: ENG_ID, matterId: M1 })
    ).rejects.toThrow("无权关联该案件");
    expect(db.engagementMatter.upsert).not.toHaveBeenCalled();
  });

  it("委托不存在时拒绝", async () => {
    db.engagement.findUnique.mockResolvedValue(null);
    await expect(linkEngagementMatter({ engagementId: ENG_ID, matterId: M1 })).rejects.toThrow("委托不存在");
  });
});
