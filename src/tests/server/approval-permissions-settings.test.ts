import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: {
  user: { findUnique: vi.fn() }, systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn()
} }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "admin" } })) }));
vi.mock("@/server/notifications/approval", () => ({ notifyDirectApprovers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveApprovalSettings } from "@/server/approval-permissions/actions";
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ active: true, systemRole: "SUPER_ADMIN" });
  db.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false, allowSelfApproval: false } });
  db.$transaction.mockImplementation(async fn => fn(db));
});
describe("审批设置保存", () => {
  it("仅保存本人审批例外，旧客户端传来的 enabled 不会写回", async () => {
    const staleInput = { enabled: false, allowSelfApproval: true };
    await saveApprovalSettings(staleInput);
    expect(db.systemSetting.upsert).toHaveBeenCalledWith({ where: { key: "approvalAuthorization" }, create: { key: "approvalAuthorization", value: { allowSelfApproval: true } }, update: { value: { allowSelfApproval: true } } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin", action: "APPROVAL_AUTHORIZATION_SETTINGS", detail: { before: { enabled: true, allowSelfApproval: false }, after: { allowSelfApproval: true } } }) });
  });
  it("账号停用或已失去管理员身份时不能保存设置", async () => {
    for (const user of [{ active: false, systemRole: "SUPER_ADMIN" }, { active: true, systemRole: "NONE" }]) {
      db.user.findUnique.mockResolvedValue(user);
      await expect(saveApprovalSettings({ allowSelfApproval: true })).rejects.toThrow("仅系统超级管理员");
    }
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it("审计失败必须传播给事务，不返回保存成功", async () => {
    db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(saveApprovalSettings({ allowSelfApproval: false })).rejects.toThrow("audit unavailable");
  });
});
