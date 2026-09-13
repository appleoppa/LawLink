// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, session } = vi.hoisted(() => {
  const database = {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn()
  };
  return {
    db: database,
    session: { user: { id: "c111111111111111111111111", role: "LAWYER", systemRole: "SUPER_ADMIN" } }
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => session),
  requireSystemAdmin: vi.fn(async () => session)
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateUserSystemRole } from "@/server/users/actions";

const targetId = "c222222222222222222222222";

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (work) => work(db));
  db.user.findUnique.mockResolvedValue({ active: true, systemRole: "SUPER_ADMIN" });
  db.user.findUniqueOrThrow.mockResolvedValue({ active: true, systemRole: "NONE" });
  db.user.count.mockResolvedValue(2);
  db.user.update.mockResolvedValue({ id: targetId });
});

describe("系统管理身份", () => {
  it("与业务岗位分开授予，并撤销目标账号的旧会话", async () => {
    await updateUserSystemRole({ id: targetId, systemRole: "SUPER_ADMIN", expectedSystemRole: "NONE" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: targetId },
      data: { systemRole: "SUPER_ADMIN", sessionVersion: { increment: 1 } }
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: session.user.id,
      action: "USER_SYSTEM_ROLE_UPDATE",
      targetId,
      detail: { before: "NONE", after: "SUPER_ADMIN" }
    }) });
  });

  it("禁止通过陈旧页面覆盖已变化的系统身份", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ active: true, systemRole: "SUPER_ADMIN" });
    await expect(updateUserSystemRole({ id: targetId, systemRole: "SUPER_ADMIN", expectedSystemRole: "NONE" })).rejects.toThrow("已变化");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("撤销时保护最后一名有效系统超级管理员", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ active: true, systemRole: "SUPER_ADMIN" });
    db.user.count.mockResolvedValue(1);
    await expect(updateUserSystemRole({ id: targetId, systemRole: "NONE", expectedSystemRole: "SUPER_ADMIN" })).rejects.toThrow("至少一个有效系统超级管理员");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("不能修改自己的系统管理身份", async () => {
    await expect(updateUserSystemRole({ id: session.user.id, systemRole: "NONE", expectedSystemRole: "SUPER_ADMIN" })).rejects.toThrow("不能修改自己的系统管理身份");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
