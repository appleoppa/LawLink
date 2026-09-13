// @vitest-environment node
/**
 * 状态轴分离（报告 §6.4 最小版）单测 —— Matter.serviceStatus 服务轴。
 *
 * 样例 6：程序结束 ≠ 服务完成。
 * - completeMatterService 显式完成服务：只动 serviceStatus，不触碰程序轴 status；
 * - 重复完成被拒；activateMatterService 从完成态回退；进行中回退被拒；
 * - 非主办被 assertCanLeadMatter 拦截；写审计 MATTER_SERVICE_COMPLETE/ACTIVATE。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session, guards, roleSvc } = vi.hoisted(() => {
  const state: Record<string, any> = {};
  const db: Record<string, any> = {
    matter: {
      findUnique: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data }))
    },
    timelineEvent: { create: vi.fn(async ({ data }: any) => ({ id: "evt1", ...data })) },
    $transaction: vi.fn()
  };
  return {
    db,
    state,
    session: { user: { id: "clawyer0000000000000000001", role: "LAWYER", rolePermissions: undefined } },
    guards: { assertMatterWritable: vi.fn(async () => {}), assertCanLeadMatter: vi.fn(async () => {}) },
    roleSvc: { checkRoleMutation: vi.fn(async () => {}) }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/archive/guard", () => guards);
vi.mock("@/lib/permissions", () => ({ assertCanLeadMatter: guards.assertCanLeadMatter }));
vi.mock("@/lib/roles/service", () => roleSvc);
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));

import { completeMatterService, activateMatterService } from "@/server/matters/lifecycle";
import { audit } from "@/server/audit";

const M = "cmatter00000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  guards.assertCanLeadMatter.mockReset();
  guards.assertCanLeadMatter.mockResolvedValue(undefined);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
});

describe("完成服务（服务轴与程序轴分离）", () => {
  it("服务完成只改 serviceStatus，不改程序轴 status", async () => {
    db.matter.findUnique.mockResolvedValue({ serviceStatus: "SERVICE_ACTIVE", status: "CLOSED" }); // 样例 6：程序已结案但服务未完成

    const res = await completeMatterService({ id: M, note: "代书与陪同开庭义务已履行完毕" });
    expect(res).toEqual({ ok: true });
    expect(db.matter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: M },
      data: { serviceStatus: "SERVICE_COMPLETED" }
    }));
    expect(JSON.stringify(db.matter.update.mock.calls[0][0].data)).not.toContain("status");
    expect(db.timelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "MATTER_SERVICE_COMPLETED", matterId: M })
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "MATTER_SERVICE_COMPLETE", targetType: "Matter", targetId: M
    }));
  });

  it("重复完成被拒绝", async () => {
    db.matter.findUnique.mockResolvedValue({ serviceStatus: "SERVICE_COMPLETED" });
    await expect(completeMatterService({ id: M })).rejects.toThrow("服务已完成");
    expect(db.matter.update).not.toHaveBeenCalled();
  });

  it("非主办/协办被拦截", async () => {
    db.matter.findUnique.mockResolvedValue({ serviceStatus: "SERVICE_ACTIVE" });
    guards.assertCanLeadMatter.mockRejectedValue(new Error("仅案件主办/协办可以完成服务"));
    await expect(completeMatterService({ id: M })).rejects.toThrow("仅案件主办/协办");
    expect(db.matter.update).not.toHaveBeenCalled();
  });
});

describe("恢复服务进行中", () => {
  it("从完成态回退到 SERVICE_ACTIVE 并写时间线", async () => {
    db.matter.findUnique.mockResolvedValue({ serviceStatus: "SERVICE_COMPLETED" });
    const res = await activateMatterService(M);
    expect(res).toEqual({ ok: true });
    expect(db.matter.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { serviceStatus: "SERVICE_ACTIVE" }
    }));
    expect(db.timelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "MATTER_SERVICE_ACTIVATED" })
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "MATTER_SERVICE_ACTIVATE" }));
  });

  it("服务尚在进行中时回退被拒绝", async () => {
    db.matter.findUnique.mockResolvedValue({ serviceStatus: "SERVICE_ACTIVE" });
    await expect(activateMatterService(M)).rejects.toThrow("服务尚在进行中");
  });
});
