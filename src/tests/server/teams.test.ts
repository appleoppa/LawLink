import { beforeEach, describe, expect, it, vi } from "vitest";
const { session, tx, db } = vi.hoisted(() => {
  const tx = {
    team: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    teamMember: { updateMany: vi.fn(), upsert: vi.fn() },
    user: { findMany: vi.fn() }, auditLog: { create: vi.fn() }
  };
  return { session: vi.fn(), tx, db: { $transaction: vi.fn((fn) => fn(tx)) } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: session, requireSystemAdmin: session }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveTeam } from "@/server/teams/actions";

const leader = "c111111111111111111111111";
const member = "c222222222222222222222222";
const teamId = "c333333333333333333333333";
const stamp = new Date("2026-09-01T00:00:00Z");
const input = { name: "测试团队", leaderId: leader, members: [{ userId: member, canViewAllMatters: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin", role: "LAWYER", systemRole: "SUPER_ADMIN" } });
  tx.team.findUnique.mockResolvedValue(null);
  tx.team.create.mockResolvedValue({ id: teamId });
  tx.team.update.mockResolvedValue({ id: teamId });
  tx.user.findMany.mockResolvedValue([{ id: leader, role: "LAWYER", active: true }, { id: member, role: "LAWYER", active: true }]);
});

describe("团队授权管理", () => {
  it.each(["LAWYER", "PRINCIPAL_LAWYER", "ASSISTANT", "FINANCE"])("%s 不能通过直接调用设置团队", async (role) => {
    session.mockRejectedValueOnce(new Error(`仅系统超级管理员可管理团队：${role}`));
    await expect(saveTeam(input)).rejects.toThrow("仅系统超级管理员");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("负责人自动成为获权成员，普通成员不默认获权", async () => {
    await saveTeam(input);
    expect(tx.teamMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { teamId, userId: leader, canViewAllMatters: true } }));
    expect(tx.teamMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { teamId, userId: member, canViewAllMatters: false } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "TEAM_CREATE", userId: "admin" }) }));
  });
  it("不能新增停用账号", async () => {
    tx.user.findMany.mockResolvedValue([{ id: leader, role: "LAWYER", active: true }, { id: member, role: "LAWYER", active: false }]);
    await expect(saveTeam(input)).rejects.toThrow("不能新增已停用");
    expect(tx.team.create).not.toHaveBeenCalled();
  });
  it("保留既有停用成员的历史案件归属", async () => {
    tx.team.findUnique.mockResolvedValue({ id: teamId, updatedAt: stamp, leaderId: leader, active: true, members: [{ userId: member, canViewAllMatters: false }] });
    tx.user.findMany.mockResolvedValue([{ id: leader, role: "LAWYER", active: true }, { id: member, role: "LAWYER", active: false }]);
    await expect(saveTeam({ ...input, id: teamId, expectedUpdatedAt: stamp })).resolves.toEqual({ ok: true, id: teamId });
  });
  it("过期编辑不能覆盖其他管理员的新授权", async () => {
    tx.team.findUnique.mockResolvedValue({ id: teamId, updatedAt: new Date(stamp.getTime() + 1000), members: [] });
    await expect(saveTeam({ ...input, id: teamId, expectedUpdatedAt: stamp })).rejects.toThrow("已被其他管理员更新");
    expect(tx.team.update).not.toHaveBeenCalled();
    expect(tx.teamMember.updateMany).not.toHaveBeenCalled();
  });
});
